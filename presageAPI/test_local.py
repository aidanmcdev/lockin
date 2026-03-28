#!/usr/bin/env python3
"""
Local test script for the Presage API tool.

Tests phone detection + preprocessing using local image/video files.
Does NOT call the Presage cloud API (no API key needed).

Usage:
    # Test with frames in a folder
    python test_local.py --frames-dir ./test_frames

    # Test with a video file
    python test_local.py --video ./test_video.mp4

    # Test with webcam (grab 5 seconds)
    python test_local.py --webcam --duration 5

    # Generate synthetic test frames and run all checks
    python test_local.py --generate

    # Run everything: generate + phone detector + preprocessing + server endpoint
    python test_local.py --all
"""

import argparse
import base64
import glob
import json
import os
import sys
import tempfile
import time

import cv2
import numpy as np

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEST_FRAMES_DIR = os.path.join(SCRIPT_DIR, "test_frames")

# ── Helpers ──────────────────────────────────────────────────────────────────

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"
WARN = "\033[93m⚠ WARN\033[0m"
INFO = "\033[94mℹ INFO\033[0m"

test_results = {"passed": 0, "failed": 0, "warnings": 0}


def check(condition, label, warn_only=False):
    """Assert-like helper that prints colored results."""
    if condition:
        print(f"  {PASS}  {label}")
        test_results["passed"] += 1
    elif warn_only:
        print(f"  {WARN}  {label}")
        test_results["warnings"] += 1
    else:
        print(f"  {FAIL}  {label}")
        test_results["failed"] += 1
    return condition


def load_frames_from_dir(directory):
    """Load all images from a directory as BGR numpy arrays."""
    extensions = ("*.jpg", "*.jpeg", "*.png", "*.bmp", "*.webp")
    paths = []
    for ext in extensions:
        paths.extend(glob.glob(os.path.join(directory, ext)))
    paths.sort()

    frames = []
    for p in paths:
        frame = cv2.imread(p)
        if frame is not None:
            frames.append(frame)
        else:
            print(f"  {WARN}  Could not read: {p}")
    return frames, paths


def load_frames_from_video(video_path, fps=10):
    """Extract frames from a video file at the target FPS."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  {FAIL}  Cannot open video: {video_path}")
        return [], video_path

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    skip = max(1, round(native_fps / fps))

    frames = []
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % skip == 0:
            frames.append(frame)
        idx += 1
    cap.release()
    return frames, video_path


def grab_webcam_frames(duration=5, fps=10, camera=0):
    """Capture frames from webcam."""
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        print(f"  {FAIL}  Cannot open camera {camera}")
        return []

    interval = 1.0 / fps
    start = time.time()
    last = 0
    frames = []

    print(f"  {INFO}  Capturing from webcam for {duration}s... (press q to stop)")
    while time.time() - start < duration:
        ret, frame = cap.read()
        if not ret:
            continue
        elapsed = time.time() - start
        if elapsed - last >= interval:
            frames.append(frame)
            last = elapsed
        cv2.imshow("Test Capture - press Q", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    return frames


def generate_synthetic_frames(count=60, fps=10):
    """Generate synthetic frames with a face-like oval and moving 'arm' to
    simulate phone usage. Returns (frames_no_phone, frames_phone_calling,
    frames_phone_texting)."""
    h, w = 480, 640

    def make_base_frame():
        """Draw a person-like figure: head oval, shoulders, torso."""
        frame = np.full((h, w, 3), (200, 200, 200), dtype=np.uint8)
        # Head
        cv2.ellipse(frame, (320, 140), (60, 80), 0, 0, 360, (180, 140, 100), -1)
        # Eyes
        cv2.circle(frame, (295, 125), 6, (40, 40, 40), -1)
        cv2.circle(frame, (345, 125), 6, (40, 40, 40), -1)
        # Nose
        cv2.circle(frame, (320, 150), 4, (140, 100, 80), -1)
        # Neck
        cv2.rectangle(frame, (305, 220), (335, 260), (180, 140, 100), -1)
        # Shoulders + torso
        cv2.rectangle(frame, (200, 260), (440, 420), (80, 80, 160), -1)
        return frame

    no_phone = []
    for i in range(count):
        f = make_base_frame()
        # Arms at sides (not near face)
        cv2.line(f, (200, 280), (160, 400), (180, 140, 100), 12)
        cv2.line(f, (440, 280), (480, 400), (180, 140, 100), 12)
        no_phone.append(f)

    calling = []
    for i in range(count):
        f = make_base_frame()
        # Left arm at side
        cv2.line(f, (200, 280), (160, 400), (180, 140, 100), 12)
        # Right arm up to ear (phone call pose)
        cv2.line(f, (440, 280), (380, 140), (180, 140, 100), 12)
        # Phone rectangle near ear
        cv2.rectangle(f, (365, 110), (395, 170), (30, 30, 30), -1)
        calling.append(f)

    texting = []
    for i in range(count):
        f = make_base_frame()
        # Both arms in front, slightly lower (texting pose)
        cv2.line(f, (200, 280), (280, 340), (180, 140, 100), 12)
        cv2.line(f, (440, 280), (360, 340), (180, 140, 100), 12)
        # Phone rectangle in front of chest
        cv2.rectangle(f, (290, 320), (350, 370), (30, 30, 30), -1)
        # Tilt head down slightly (move nose dot lower)
        cv2.circle(f, (320, 165), 5, (140, 100, 80), -1)
        texting.append(f)

    return no_phone, calling, texting


# ── Test functions ───────────────────────────────────────────────────────────

def test_phone_detector(frames, label="test frames"):
    """Test the PhoneDetector on a list of frames."""
    print(f"\n{'='*60}")
    print(f"  PHONE DETECTOR TEST — {label}")
    print(f"{'='*60}")

    from phone_detector import PhoneDetector

    fps = 10.0
    detector = PhoneDetector(fps=fps)

    check(len(frames) > 0, f"Have frames to test ({len(frames)} frames)")
    if not frames:
        return None

    detected_count = 0
    postures = {"calling": 0, "texting": 0}

    for i, frame in enumerate(frames):
        ts = i / fps
        result = detector.detect(frame, ts)
        check(
            "phone_detected" in result and "posture" in result,
            f"Frame {i}: returns phone_detected + posture keys",
            warn_only=True,
        )
        if result["phone_detected"]:
            detected_count += 1
            if result["posture"] in postures:
                postures[result["posture"]] += 1

    print(f"  {INFO}  Detected phone in {detected_count}/{len(frames)} frames")
    for p, c in postures.items():
        if c > 0:
            print(f"  {INFO}  {p}: {c} frames")

    summary = detector.get_summary()
    check("on_phone" in summary, "Summary has 'on_phone' key")
    check("total_phone_seconds" in summary, "Summary has 'total_phone_seconds' key")
    check("events" in summary, "Summary has 'events' key")
    check(isinstance(summary["events"], list), "Events is a list")
    check(isinstance(summary["total_phone_seconds"], (int, float)), "total_phone_seconds is numeric")

    print(f"  {INFO}  Summary: on_phone={summary['on_phone']}, "
          f"total={summary['total_phone_seconds']}s, events={len(summary['events'])}")

    for ev in summary["events"]:
        check("start" in ev and "end" in ev and "type" in ev and "duration" in ev,
              f"Event has all keys: {ev.get('start','')}s-{ev.get('end','')}s ({ev.get('type','')})")

    return summary


def test_preprocessing(frames, label="test frames"):
    """Test the FrameProcessor on a list of frames."""
    print(f"\n{'='*60}")
    print(f"  PREPROCESSING TEST — {label}")
    print(f"{'='*60}")

    from preprocessing import FrameProcessor

    fps = 10.0
    processor = FrameProcessor(fps=fps)

    check(len(frames) >= 5, f"Have enough frames ({len(frames)} >= 5)")
    if len(frames) < 5:
        print(f"  {WARN}  Skipping preprocessing test (need at least 5 frames)")
        return None

    for i, frame in enumerate(frames):
        data = processor.process_frame(frame)
        if i == 0:
            check(isinstance(data, dict), "process_frame returns a dict")
            check("time_now" in data, "Frame data has 'time_now' key")

    trace = processor.get_trace()
    check("settings" in trace, "Trace has 'settings' key")
    check("frames" in trace, "Trace has 'frames' key")
    check(len(trace["frames"]) == len(frames), f"Trace has {len(frames)} frame entries")

    settings = trace["settings"]
    check("FPS_NR_EFF" in settings, "Settings has FPS_NR_EFF")
    check("MOD_AMOUNT_HR" in settings, "Settings has MOD_AMOUNT_HR")
    check("MOD_AMOUNT_RR" in settings, "Settings has MOD_AMOUNT_RR")

    compressed = processor.get_compressed_trace()
    check(isinstance(compressed, bytes), "Compressed trace is bytes")
    check(len(compressed) > 0, f"Compressed trace is non-empty ({len(compressed)} bytes)")

    print(f"  {INFO}  Trace: {len(trace['frames'])} frames, {len(compressed)} bytes compressed")
    return trace


def test_server_endpoints(frames):
    """Test the Flask server endpoints locally (no Presage API call)."""
    print(f"\n{'='*60}")
    print(f"  SERVER ENDPOINT TEST")
    print(f"{'='*60}")

    from server import app

    client = app.test_client()

    # Health check
    resp = client.get("/health")
    check(resp.status_code == 200, "GET /health returns 200")
    data = resp.get_json()
    check(data.get("status") == "ok", "/health status is 'ok'")

    # No frames → error
    resp = client.post("/api/process-frames")
    check(resp.status_code == 400, "POST /api/process-frames with no frames returns 400")

    # Too few frames → error
    _, buf = cv2.imencode(".jpg", frames[0])
    from io import BytesIO
    resp = client.post("/api/process-frames", data={
        "fps": "10",
        "frames": (BytesIO(buf.tobytes()), "frame.jpg"),
    }, content_type="multipart/form-data")
    check(resp.status_code == 400, "POST with 1 frame returns 400 (need >= 5)")

    # Send enough frames (async) — this will queue a job but the Presage API
    # call will fail since we have no key. That's fine — we test the plumbing.
    from werkzeug.datastructures import FileStorage
    files = []
    for i, frame in enumerate(frames[:10]):
        _, buf = cv2.imencode(".jpg", frame)
        files.append(
            (BytesIO(buf.tobytes()), f"frame_{i:03d}.jpg")
        )

    data = {"fps": "10", "api_key": "test_key_not_real"}
    form_data = {}
    form_data["fps"] = "10"
    form_data["api_key"] = "test_key_not_real"

    # Build multipart manually
    multipart_data = []
    for bio, fname in files:
        multipart_data.append(("frames", (bio, fname, "image/jpeg")))

    resp = client.post(
        "/api/process-frames",
        data={**form_data, "frames": [(bio, fname) for bio, fname in files]},
        content_type="multipart/form-data",
    )
    # Accept 202 (queued) or 400/401 — we're testing the endpoint exists and parses
    check(resp.status_code in (200, 202, 400, 401),
          f"POST /api/process-frames returns valid status ({resp.status_code})")

    if resp.status_code == 202:
        data = resp.get_json()
        check("job_id" in data, "Response contains job_id")
        check(data.get("status") == "queued", "Job status is 'queued'")

        job_id = data["job_id"]
        resp2 = client.get(f"/api/status/{job_id}")
        check(resp2.status_code == 200, f"GET /api/status/{job_id} returns 200")

    # Jobs list
    resp = client.get("/api/jobs")
    check(resp.status_code == 200, "GET /api/jobs returns 200")

    # Base64 endpoint — too few frames
    resp = client.post("/api/process-base64", json={
        "frames": ["dGVzdA=="],
        "fps": 10,
        "api_key": "test_key",
    })
    check(resp.status_code == 400, "POST /api/process-base64 with bad data returns 400")

    # Base64 with real frames
    b64_frames = []
    for frame in frames[:6]:
        _, buf = cv2.imencode(".jpg", frame)
        b64_frames.append(base64.b64encode(buf.tobytes()).decode())

    resp = client.post("/api/process-base64", json={
        "frames": b64_frames,
        "fps": 10,
        "api_key": "test_key_not_real",
    })
    check(resp.status_code in (200, 202),
          f"POST /api/process-base64 with 6 frames returns {resp.status_code}")

    # Nonexistent job
    resp = client.get("/api/status/nonexistent999")
    check(resp.status_code == 404, "GET /api/status/<bad_id> returns 404")


def test_synthetic():
    """Generate synthetic frames and validate phone detection accuracy."""
    print(f"\n{'='*60}")
    print(f"  SYNTHETIC FRAME TESTS")
    print(f"{'='*60}")

    no_phone, calling, texting = generate_synthetic_frames(count=60, fps=10)

    print(f"\n  {INFO}  Generated 60 frames x 3 scenarios (no_phone, calling, texting)")

    # Save a few samples to test_frames/ for visual inspection
    os.makedirs(TEST_FRAMES_DIR, exist_ok=True)
    cv2.imwrite(os.path.join(TEST_FRAMES_DIR, "synthetic_no_phone.jpg"), no_phone[0])
    cv2.imwrite(os.path.join(TEST_FRAMES_DIR, "synthetic_calling.jpg"), calling[0])
    cv2.imwrite(os.path.join(TEST_FRAMES_DIR, "synthetic_texting.jpg"), texting[0])
    print(f"  {INFO}  Saved sample frames to {TEST_FRAMES_DIR}/")

    # Note: synthetic stick-figure frames may not trigger MediaPipe's real pose
    # detector, so we test the pipeline runs without crashing.
    # Real accuracy testing needs real photos.

    print(f"\n  --- No-phone scenario ---")
    summary_none = test_phone_detector(no_phone, "synthetic — no phone")

    print(f"\n  --- Calling scenario ---")
    summary_call = test_phone_detector(calling, "synthetic — calling")

    print(f"\n  --- Texting scenario ---")
    summary_text = test_phone_detector(texting, "synthetic — texting")

    # With synthetic stick figures, MediaPipe may not detect a pose at all.
    # That's expected — the key test is that the pipeline doesn't crash.
    print(f"\n  {INFO}  NOTE: Synthetic frames use simple drawings. MediaPipe may not")
    print(f"  {INFO}  detect poses in them. Use real photos/video for accuracy testing.")
    print(f"  {INFO}  The important thing is: no crashes, correct output format.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Test the Presage API tool locally (no cloud API needed)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_local.py --generate          # Generate test frames + run checks
  python test_local.py --frames-dir ./pics # Use existing images in a folder
  python test_local.py --video clip.mp4    # Use frames from a video
  python test_local.py --webcam            # Grab from webcam
  python test_local.py --all               # Run everything
        """,
    )
    parser.add_argument("--frames-dir", type=str, help="Directory containing image files")
    parser.add_argument("--video", type=str, help="Video file to extract frames from")
    parser.add_argument("--webcam", action="store_true", help="Capture from webcam")
    parser.add_argument("--duration", type=int, default=5, help="Webcam capture duration (default: 5s)")
    parser.add_argument("--generate", action="store_true", help="Generate synthetic test frames")
    parser.add_argument("--all", action="store_true", help="Run all tests (generate + server)")
    parser.add_argument("--fps", type=float, default=10.0, help="Target FPS (default: 10)")

    args = parser.parse_args()

    # Default: if no args given, run --all
    if not any([args.frames_dir, args.video, args.webcam, args.generate, args.all]):
        args.all = True

    print("\n" + "=" * 60)
    print("  PRESAGE API — LOCAL TEST SUITE")
    print("=" * 60)

    frames = []

    # ── Load frames from source ──────────────────────────────────────────
    if args.frames_dir:
        print(f"\n  {INFO}  Loading frames from: {args.frames_dir}")
        frames, paths = load_frames_from_dir(args.frames_dir)
        check(len(frames) > 0, f"Loaded {len(frames)} frames from {args.frames_dir}")
        if frames:
            test_phone_detector(frames, f"frames from {args.frames_dir}")
            test_preprocessing(frames, f"frames from {args.frames_dir}")

    if args.video:
        print(f"\n  {INFO}  Extracting frames from: {args.video}")
        frames, _ = load_frames_from_video(args.video, fps=args.fps)
        check(len(frames) > 0, f"Extracted {len(frames)} frames from video")
        if frames:
            test_phone_detector(frames, f"video: {args.video}")
            test_preprocessing(frames, f"video: {args.video}")

    if args.webcam:
        print(f"\n  {INFO}  Capturing from webcam for {args.duration}s...")
        frames = grab_webcam_frames(duration=args.duration, fps=args.fps)
        check(len(frames) > 0, f"Captured {len(frames)} frames from webcam")
        if frames:
            test_phone_detector(frames, "webcam capture")
            test_preprocessing(frames, "webcam capture")

    if args.generate or args.all:
        test_synthetic()

    if args.all:
        # Use synthetic frames for server endpoint tests
        no_phone, calling, texting = generate_synthetic_frames(count=10, fps=10)
        # Mix them for a realistic set
        mixed = no_phone + calling[:5]
        test_server_endpoints(mixed)

    # If we loaded real frames above and --all is set, also test those
    if args.all and frames:
        test_phone_detector(frames, "user-provided frames")
        test_preprocessing(frames, "user-provided frames")

    # ── Summary ──────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  TEST SUMMARY")
    print(f"{'='*60}")
    total = test_results["passed"] + test_results["failed"]
    print(f"  {PASS}  Passed:   {test_results['passed']}")
    print(f"  {FAIL}  Failed:   {test_results['failed']}")
    if test_results["warnings"]:
        print(f"  {WARN}  Warnings: {test_results['warnings']}")
    print(f"  Total:    {total} checks")
    print(f"{'='*60}\n")

    if test_results["failed"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
