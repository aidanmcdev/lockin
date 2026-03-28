#!/bin/bash
# Build script for the Presage API server
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"

echo "=== Building Presage API ==="
echo "Project: $PROJECT_DIR"
echo "Build:   $BUILD_DIR"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo "[1/2] Configuring with CMake..."
cmake "$PROJECT_DIR" -DCMAKE_BUILD_TYPE=Release

echo "[2/2] Building..."
make -j"$(nproc)"

echo ""
echo "=== Build complete! ==="
echo "Binary: $BUILD_DIR/presage_api"
echo ""
echo "Usage:"
echo "  # Webcam mode (with display)"
echo "  $BUILD_DIR/presage_api --mode webcam --api-key YOUR_KEY"
echo ""
echo "  # Webcam mode (headless, terminal only)"
echo "  $BUILD_DIR/presage_api --mode webcam --api-key YOUR_KEY --headless"
echo ""
echo "  # Server mode"
echo "  $BUILD_DIR/presage_api --mode server --api-key YOUR_KEY --port 8080"
echo ""
echo "  # Test server with curl:"
echo "  curl http://localhost:8080/health"
echo "  curl -X POST -F 'video=@test.mp4' http://localhost:8080/api/analyze"
