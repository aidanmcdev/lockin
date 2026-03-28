#!/bin/bash
# =============================================================================
#  Presage API — Full EC2 Deployment Script (Debian / Ubuntu)
#  Target: AWS Free Tier t2.micro or t3.micro
#
#  Usage:
#    1. Launch an EC2 instance (Ubuntu 22.04+ AMI)
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
echo "  Presage API — EC2 Deployment"
echo "============================================="
echo -e "${NC}"

# ------------------------------------------------------------------
# 1. System dependencies
# ------------------------------------------------------------------
echo -e "${YELLOW}[1/6] Installing system dependencies...${NC}"
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-pip python3-venv python3-dev \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev \
    ffmpeg curl git

# ------------------------------------------------------------------
# 2. Swap file (t2.micro only has 1GB RAM — mediapipe needs more)
# ------------------------------------------------------------------
echo -e "${YELLOW}[2/6] Setting up swap (2GB)...${NC}"
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
    echo "  Swap enabled (2GB)"
else
    echo "  Swap already exists, skipping"
fi

# ------------------------------------------------------------------
# 3. Python virtual environment + dependencies
# ------------------------------------------------------------------
echo -e "${YELLOW}[3/6] Setting up Python environment...${NC}"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

pip install --upgrade pip -q
pip install -r "$APP_DIR/requirements.txt" -q

echo "  Installed $(pip list --format=columns | wc -l) packages"

# ------------------------------------------------------------------
# 4. Environment file
# ------------------------------------------------------------------
echo -e "${YELLOW}[4/6] Configuring environment...${NC}"
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
# 5. Systemd service
# ------------------------------------------------------------------
echo -e "${YELLOW}[5/6] Installing systemd service...${NC}"

CURRENT_USER=$(whoami)
cat > /tmp/$SERVICE_NAME.service <<SERVICEEOF
[Unit]
Description=Presage API Server
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR
Environment=PATH=$VENV_DIR/bin:/usr/bin
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
# 6. Firewall (if ufw is active)
# ------------------------------------------------------------------
echo -e "${YELLOW}[6/6] Checking firewall...${NC}"
if command -v ufw &> /dev/null && sudo ufw status | grep -q "active"; then
    sudo ufw allow $PORT/tcp
    echo "  Opened port $PORT in ufw"
else
    echo "  ufw not active (make sure EC2 security group allows port $PORT)"
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
echo "       curl http://<YOUR-EC2-PUBLIC-IP>:$PORT/health"
echo ""
echo "  Manual run (for debugging):"
echo "       source $VENV_DIR/bin/activate"
echo "       python main.py server --port $PORT"
echo ""
