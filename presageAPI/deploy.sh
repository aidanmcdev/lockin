#!/bin/bash
# Deploy script for Debian EC2 (free tier t2.micro / t3.micro)
# Run this on your EC2 instance after cloning the repo.

set -e

echo "=== Presage API - EC2 Deployment ==="

# Install system dependencies
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev ffmpeg

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo ">>> IMPORTANT: Edit .env and add your PRESAGE_API_KEY <<<"
    echo "    nano .env"
    echo ""
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "To run the API server:"
echo "  source venv/bin/activate"
echo "  python server.py"
echo ""
echo "Or with gunicorn (production):"
echo "  source venv/bin/activate"
echo "  gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 4 --timeout 600 server:app"
echo ""
echo "To run as a systemd service:"
echo "  sudo cp presage-api.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable presage-api"
echo "  sudo systemctl start presage-api"
