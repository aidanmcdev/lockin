#!/usr/bin/env python3
"""
Presage API Tool - Entry point.

Usage:
    python main.py webcam [--duration 30] [--fps 10] [--camera 0]
    python main.py server [--host 0.0.0.0] [--port 5000]
"""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description="Presage API Tool")
    subparsers = parser.add_subparsers(dest="mode", help="Operating mode")

    # Webcam mode
    cam_parser = subparsers.add_parser("webcam", help="Capture from webcam and print vitals to terminal")
    cam_parser.add_argument("--duration", type=int, default=30, help="Recording duration in seconds")
    cam_parser.add_argument("--fps", type=float, default=10.0, help="Target FPS for capture")
    cam_parser.add_argument("--camera", type=int, default=0, help="Camera device index")

    # Server mode
    srv_parser = subparsers.add_parser("server", help="Run the API server (production mode)")
    srv_parser.add_argument("--host", default="0.0.0.0", help="Bind host")
    srv_parser.add_argument("--port", type=int, default=5000, help="Bind port")

    args = parser.parse_args()

    if args.mode == "webcam":
        from webcam_mode import capture_and_process
        capture_and_process(duration=args.duration, fps=args.fps, camera_index=args.camera)

    elif args.mode == "server":
        from server import app
        from config import PRESAGE_API_KEY
        import logging
        if not PRESAGE_API_KEY:
            logging.warning("PRESAGE_API_KEY not set! Set it in .env or pass per-request.")
        logging.info(f"Starting Presage API server on {args.host}:{args.port}")
        app.run(host=args.host, port=args.port, debug=False, threaded=True)

    else:
        parser.print_help()
        print("\nExamples:")
        print("  python main.py webcam --duration 30")
        print("  python main.py server --port 5000")
        sys.exit(1)


if __name__ == "__main__":
    main()
