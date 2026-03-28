#!/bin/bash
# Setup script for Ubuntu 22.04 (EC2 or local)
# Installs SmartSpectra SDK and all build dependencies
set -e

echo "=== Presage API: Ubuntu 22.04 Setup ==="

# Install build tools and dependencies
echo "[1/4] Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    git \
    cmake \
    libcurl4-openssl-dev \
    libssl-dev \
    libv4l-dev \
    libgles2-mesa-dev \
    libunwind-dev \
    libopencv-dev

# Add Presage SmartSpectra APT repository
echo "[2/4] Adding Presage APT repository..."
curl -fsSL https://apt.presagetech.com/presage-archive-keyring.gpg \
    | sudo gpg --dearmor -o /usr/share/keyrings/presage-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/presage-archive-keyring.gpg] https://apt.presagetech.com jammy main" \
    | sudo tee /etc/apt/sources.list.d/presage.list > /dev/null

# Install SmartSpectra SDK
echo "[3/4] Installing SmartSpectra SDK..."
sudo apt-get update
sudo apt-get install -y libsmartspectra-dev

echo "[4/4] Verifying installation..."
dpkg -l | grep smartspectra || echo "Warning: smartspectra package not found in dpkg list"

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "  1. Run: ./scripts/build.sh"
echo "  2. Run: ./build/presage_api --mode webcam --api-key YOUR_KEY"
