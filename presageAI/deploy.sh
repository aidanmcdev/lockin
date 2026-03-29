#!/bin/bash
# =============================================================================
#  Presage API — Full EC2 Deployment Script (Ubuntu 22.04)
#  Uses SmartSpectra C++ SDK for vitals extraction.
#
#  Usage:
#    1. Launch an EC2 instance (Ubuntu 22.04 AMI, t2.small+ recommended)
#    2. SSH in: ssh -i your-key.pem ubuntu@<public-ip>
#    3. Clone the repo and run:
#         cd presageAI
#         chmod +x deploy.sh
#         ./deploy.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="presage-api"
VENV_DIR="$APP_DIR/venv"
PORT="${PORT:-5000}"

echo -e "${GREEN}"
echo "============================================="
echo "  Presage API — EC2 Deployment (C++ SDK)"
echo "============================================="
echo -e "${NC}"

# ------------------------------------------------------------------
# 1. System dependencies
# ------------------------------------------------------------------
echo -e "${YELLOW}[1/8] Installing system dependencies...${NC}"
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-pip python3-venv python3-dev \
    build-essential git curl gpg \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev \
    libcurl4-openssl-dev libssl-dev pkg-config \
    libv4l-dev libgles2-mesa-dev libunwind-dev \
    ffmpeg

# ------------------------------------------------------------------
# 2. Install CMake 3.27+
# ------------------------------------------------------------------
echo -e "${YELLOW}[2/8] Installing CMake 3.27...${NC}"
CMAKE_VERSION=$(cmake --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+' || echo "0.0")
if [ "$(echo "$CMAKE_VERSION 3.27" | awk '{if ($1 >= $2) print 1; else print 0}')" = "0" ]; then
    curl -sL -o /tmp/cmake.sh \
        https://github.com/Kitware/CMake/releases/download/v3.27.0/cmake-3.27.0-linux-x86_64.sh
    chmod +x /tmp/cmake.sh
    sudo /tmp/cmake.sh --skip-license --prefix=/usr/local
    rm /tmp/cmake.sh
    echo "  CMake $(cmake --version | head -1) installed"
else
    echo "  CMake $CMAKE_VERSION already sufficient"
fi

# ------------------------------------------------------------------
# 3. Install SmartSpectra C++ SDK
# ------------------------------------------------------------------
echo -e "${YELLOW}[3/8] Installing SmartSpectra C++ SDK...${NC}"
if ! dpkg -s libsmartspectra-dev &>/dev/null; then
    curl -s "https://presage-security.github.io/PPA/KEY.gpg" | gpg --dearmor | \
        sudo tee /etc/apt/trusted.gpg.d/presage-technologies.gpg >/dev/null
    sudo curl -s --compressed -o /etc/apt/sources.list.d/presage-technologies.list \
        "https://presage-security.github.io/PPA/presage-technologies.list"
    sudo apt-get update -qq
    sudo apt-get install -y libsmartspectra-dev
    echo "  SmartSpectra SDK installed"
else
    echo "  SmartSpectra SDK already installed"
fi

# ------------------------------------------------------------------
# 4. Build the C++ vitals extractor
# ------------------------------------------------------------------
echo -e "${YELLOW}[4/8] Building C++ vitals extractor...${NC}"
cd "$APP_DIR/smartspectra"
mkdir -p build
cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
echo "  Built: $APP_DIR/smartspectra/build/extract_vitals"
cd "$APP_DIR"

# ------------------------------------------------------------------
# 5. Swap file (t2.micro/small only has 1-2GB RAM)
# ------------------------------------------------------------------
echo -e "${YELLOW}[5/8] Setting up swap (4GB)...${NC}"
if [ ! -f /swapfile ]; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
    echo "  Swap enabled (4GB)"
else
    echo "  Swap already exists, skipping"
fi

# ------------------------------------------------------------------
# 6. Python virtual environment (thin HTTP layer only)
# ------------------------------------------------------------------
echo -e "${YELLOW}[6/8] Setting up Python environment...${NC}"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

pip install --upgrade pip
pip install -r "$APP_DIR/requirements.txt"

echo "  Installed $(pip list --format=columns | wc -l) packages"

# ------------------------------------------------------------------
# 7. Environment file
# ------------------------------------------------------------------
echo -e "${YELLOW}[7/8] Configuring environment...${NC}"
if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    echo ""
    echo -e "${RED}  >>> ACTION REQUIRED: Edit .env and add your PRESAGE_API_KEY <<<${NC}"
    echo "      nano $APP_DIR/.env"
    echo ""
else
    echo "  .env already exists"
fi

# ------------------------------------------------------------------
# 8. Systemd service
# ------------------------------------------------------------------
echo -e "${YELLOW}[8/8] Installing systemd service...${NC}"

CURRENT_USER=$(whoami)
cat > /tmp/$SERVICE_NAME.service <<SERVICEEOF
[Unit]
Description=Presage API Server (SmartSpectra C++ SDK)
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR
Environment=PATH=$VENV_DIR/bin:$APP_DIR/smartspectra/build:/usr/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$VENV_DIR/bin/gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 600 server:app
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo cp /tmp/$SERVICE_NAME.service /etc/systemd/system/$SERVICE_NAME.service
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
echo "  Service installed and enabled"

# ------------------------------------------------------------------
# Firewall
# ------------------------------------------------------------------
if command -v ufw &> /dev/null && sudo ufw status | grep -q "active"; then
    sudo ufw allow $PORT/tcp
    echo "  Opened port $PORT in ufw"
fi

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
echo ""
echo -e "${GREEN}============================================="
echo "  Deployment complete!"
echo "=============================================${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Add your API key:"
echo "       nano $APP_DIR/.env"
echo ""
echo "  2. Start the service:"
echo "       sudo systemctl start $SERVICE_NAME"
echo ""
echo "  3. Check it's running:"
echo "       sudo systemctl status $SERVICE_NAME"
echo "       curl http://localhost:$PORT/health"
echo ""
echo "  4. View logs:"
echo "       sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "  5. Test from your machine:"
echo "       curl.exe -X POST http://<EC2-IP>:$PORT/api/process-sync -F \"video=@your_video.mp4\""
echo ""
