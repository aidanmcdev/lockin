#!/usr/bin/env python3
"""
Local test suite for Presage API.

Tests preprocessing, phone detection, and server endpoints without needing
a Presage API key (except for the full integration test).

Usage:
    python test_local.py --generate          # Test with synthetic frames
    python test_local.py --video myvideo.mp4 # Test with a video file
    python test_local.py --webcam            # Test with webcam capture
    python test_local.py --all               # Run all available tests
"""

import argparse
import io
import json
import os
import sys
import time
import traceback

import cv2
import numpy as np


# Colors for terminal output
class C:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    RESET = "\033[0m"
    BOLD = "\033[1m"


results = {"pass": 0, "fail": 0, "warn": 0}


def ok(msg):
    results["pass"] += 1
    print(f"  {C.GREEN}\u2713 PASS{C.RESET} {msg}")


def fail(msg):
    results["fail"] += 1
    print(f"  {C.RED}\u2717 FAIL{C.RESET} {msg}")


def warn(msg):
    results["warn"] += 1
    print(f"  {C.YELLOW}\u26a0 WARN{C.RESET} {msg}")


def section(title):
    print(f"\n{C.BOLD}{C.CYAN}--- {title} ---{C.RESET}")


# ---- Frame generators ----

def generate_synthetic_frames(count=100, fps=10.0):
    """Generate synthetic frames with a face-like oval for testing."""
    frames = []
    for i in range(count):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        # Background with slight color variation (simulates lighting)
        frame[:] = (40 + i % 20, 40 + i % 15, 40 + i % 10)
        # Face-like oval
        cv2.ellipse(frame, (320, 200), (80, 100), 0, 0, 360, (180, 160, 140), -1)
        # Eyes
        cv2.circle(frame, (290, 180), 8, (255, 255, 255), -1)
        cv2.circle(frame, (350, 180), 8, (255, 255, 255), -1)
        cv2.circle(frame, (290, 180), 4, (50, 30, 20), -1)
        cv2.circle(frame, (350, 180), 4, (50, 30, 20), -1)
        # Nose
        cv2.line(frame, (320, 190), (315, 215), (160, 140, 120), 2)
        # Mouth
        cv2.ellipse(frame, (320, 235), (20, 8), 0, 0, 180, (120, 80, 80), 2)
        # Body
        cv2.rectangle(frame, (250, 300), (390, 480), (100, 80, 60), -1)
        frames.append(frame)
    return frames


def extract_video_frames(video_path, fps=10.0, max_frames=300):
    """Extract frames from a video file at target FPS."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"ERROR: Cannot open video: {video_path}")
        return []

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    skip = max(1, round(native_fps / fps))

    frames = []
    idx = 0
    while len(frames) < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % skip == 0:
            frames.append(frame)
        idx += 1
    cap.release()
    print(f"  Extracted {len(frames)} frames from {video_path} (native {native_fps:.0f} fps, target {fps} fps)")
    return frames


def capture_webcam_frames(duration=5, fps=10.0, camera=0):
    """Capture frames from webcam."""
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        print(f"ERROR: Cannot open camera {camera}")
        return []

    frames = []
    frame_interval = 1.0 / fps
    start = time.time()
    last_capture = 0

    while time.time() - start < duration:
        ret, frame = cap.read()
        if not ret:
            continue
        elapsed = time.time() - start
        if elapsed - last_capture >= frame_interval:
            frames.append(frame)
            last_capture = elapsed

    cap.release()
    print(f"  Captured {len(frames)} frames in {duration}s from camera {camera}")
    return frames


# ---- Test functions ----

def test_preprocessing(frames, label=""):
    """Test the preprocessing pipeline."""
    section(f"Preprocessing Test {label}")
    try:
        from preprocessing import FrameProcessor

        processor = FrameProcessor(fps=10.0)
        for frame in frames:
            processor.process_frame(frame)

        trace = processor.get_trace()
        compressed = processor.get_compressed_trace()

        if len(trace["frames"]) == len(frames):
            ok(f"Processed all {len(frames)} frames")
        else:
            fail(f"Expected {len(frames)} frames, got {len(trace['frames'])}")

        if trace["settings"]["FPS_NR_EFF"] > 0:
            ok(f"Settings valid: FPS_NR_EFF={trace['settings']['FPS_NR_EFF']}")
        else:
            fail("Invalid FPS_NR_EFF")

        if len(compressed) > 0:
            ratio = len(compressed) / max(1, len(json.dumps(trace).encode()))
            ok(f"Compressed trace: {len(compressed)} bytes (ratio: {ratio:.2f})")
        else:
            fail("Empty compressed trace")

        # Check if any frames got BGR data (face detected)
        bgr_count = sum(1 for f in trace["frames"] if f.get("bgr") and len(f["bgr"]) > 0)
        if bgr_count > 0:
            ok(f"Face detected in {bgr_count}/{len(frames)} frames")
        else:
            warn("No face detected in any frame (expected for synthetic frames)")

        return True
    except Exception as e:
        fail(f"Preprocessing error: {e}")
        traceback.print_exc()
        return False


def test_phone_detector(frames, label=""):
    """Test phone detection."""
    section(f"Phone Detection Test {label}")
    try:
        from phone_detector import PhoneDetector

        detector = PhoneDetector(fps=10.0)
        detections = 0
        for i, frame in enumerate(frames):
            result = detector.detect(frame, i / 10.0)
            if result["phone_detected"]:
                detections += 1

        summary = detector.get_summary()

        ok(f"Processed {len(frames)} frames, {detections} detections")
        ok(f"On phone: {summary['on_phone']}, total: {summary['total_phone_seconds']}s")

        if len(summary["events"]) > 0:
            for ev in summary["events"]:
                print(f"    Event: {ev['start']}s-{ev['end']}s ({ev['type']}, {ev['duration']}s)")

        return True
    except Exception as e:
        fail(f"Phone detection error: {e}")
        traceback.print_exc()
        return False


def test_server_endpoints(frames):
    """Test Flask server endpoints (no API key needed for plumbing)."""
    section("Server Endpoint Tests")
    try:
        from server import app

        client = app.test_client()

        # Health check
        resp = client.get("/health")
        if resp.status_code == 200 and resp.get_json()["status"] == "ok":
            ok("GET /health returns 200")
        else:
            fail(f"GET /health returned {resp.status_code}")

        # Jobs list (empty)
        resp = client.get("/api/jobs")
        if resp.status_code == 200:
            ok("GET /api/jobs returns 200")
        else:
            fail(f"GET /api/jobs returned {resp.status_code}")

        # Missing job
        resp = client.get("/api/status/nonexistent")
        if resp.status_code == 404:
            ok("GET /api/status/nonexistent returns 404")
        else:
            fail(f"Expected 404, got {resp.status_code}")

        # process-frames with no frames
        resp = client.post("/api/process-frames")
        if resp.status_code == 400:
            ok("POST /api/process-frames (empty) returns 400")
        else:
            fail(f"Expected 400 for empty frames, got {resp.status_code}")

        # process-frames with too few frames (need API key to actually process)
        data = {}
        frame_files = []
        for i, frame in enumerate(frames[:3]):
            _, buf = cv2.imencode(".jpg", frame)
            frame_files.append((io.BytesIO(buf.tobytes()), f"frame_{i}.jpg"))

        from werkzeug.datastructures import FileStorage
        resp = client.post(
            "/api/process-frames",
            data={
                "fps": "10",
                "api_key": "test_key_not_real",
                "frames": [
                    (io.BytesIO(cv2.imencode(".jpg", f)[1].tobytes()), f"frame_{i}.jpg")
                    for i, f in enumerate(frames[:3])
                ],
            },
            content_type="multipart/form-data",
        )
        if resp.status_code == 400:
            ok("POST /api/process-frames (too few) returns 400")
        else:
            warn(f"Expected 400 for 3 frames, got {resp.status_code}: {resp.get_json()}")

        # process-video with no file
        resp = client.post("/api/process-video")
        if resp.status_code == 400:
            ok("POST /api/process-video (no file) returns 400")
        else:
            fail(f"Expected 400, got {resp.status_code}")

        return True
    except Exception as e:
        fail(f"Server test error: {e}")
        traceback.print_exc()
        return False


def test_presage_client_init():
    """Test PresageClient initialization (no actual API calls)."""
    section("Presage Client Init Test")
    try:
        from presage_client import PresageClient

        # Should raise without API key
        try:
            os.environ.pop("PRESAGE_API_KEY", None)
            client = PresageClient(api_key=None)
            fail("Should have raised ValueError without API key")
        except ValueError:
            ok("Raises ValueError when no API key set")

        # Should work with explicit key
        client = PresageClient(api_key="test_key_123")
        if client.api_key == "test_key_123":
            ok("Accepts explicit API key")
        else:
            fail("API key not set correctly")

        return True
    except Exception as e:
        fail(f"Client init error: {e}")
        traceback.print_exc()
        return False


# ---- Main ----

def main():
    parser = argparse.ArgumentParser(description="Presage API Local Tests")
    parser.add_argument("--generate", action="store_true", help="Test with synthetic frames")
    parser.add_argument("--video", type=str, help="Test with video file")
    parser.add_argument("--webcam", action="store_true", help="Test with webcam capture")
    parser.add_argument("--duration", type=int, default=5, help="Webcam capture duration (default 5s)")
    parser.add_argument("--fps", type=float, default=10.0, help="Target FPS")
    parser.add_argument("--all", action="store_true", help="Run all available tests")
    args = parser.parse_args()

    if not any([args.generate, args.video, args.webcam, args.all]):
        args.generate = True  # default to synthetic test

    print(f"{C.BOLD}Presage API — Local Test Suite{C.RESET}")
    print(f"{'='*50}\n")

    # Always test client init
    test_presage_client_init()

    if args.generate or args.all:
        section("Generating synthetic frames")
        frames = generate_synthetic_frames(count=50, fps=args.fps)
        test_preprocessing(frames, "(synthetic)")
        test_phone_detector(frames, "(synthetic)")
        test_server_endpoints(frames)

    if args.video or args.all:
        video_path = args.video
        if args.all and not args.video:
            # Look for any video in test_frames/
            for f in os.listdir("test_frames") if os.path.isdir("test_frames") else []:
                if f.endswith((".mp4", ".avi", ".mov")):
                    video_path = os.path.join("test_frames", f)
                    break
        if video_path and os.path.exists(video_path):
            frames = extract_video_frames(video_path, fps=args.fps)
            if len(frames) >= 5:
                test_preprocessing(frames, f"({os.path.basename(video_path)})")
                test_phone_detector(frames, f"({os.path.basename(video_path)})")
            else:
                warn(f"Not enough frames from {video_path}")
        elif video_path:
            warn(f"Video file not found: {video_path}")

    if args.webcam or args.all:
        frames = capture_webcam_frames(duration=args.duration, fps=args.fps)
        if len(frames) >= 5:
            test_preprocessing(frames, "(webcam)")
            test_phone_detector(frames, "(webcam)")
        else:
            warn("Not enough webcam frames captured")

    # Summary
    print(f"\n{'='*50}")
    total = results["pass"] + results["fail"] + results["warn"]
    print(f"{C.BOLD}Results: {results['pass']}/{total} passed", end="")
    if results["fail"]:
        print(f", {C.RED}{results['fail']} failed{C.RESET}", end="")
    if results["warn"]:
        print(f", {C.YELLOW}{results['warn']} warnings{C.RESET}", end="")
    print(f"{C.RESET}")

    sys.exit(1 if results["fail"] > 0 else 0)


if __name__ == "__main__":
    main()
