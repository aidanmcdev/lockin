#!/usr/bin/env python3
"""
Webcam Mode - Captures frames from webcam, preprocesses them,
sends to Presage API, and prints vitals to terminal.

Usage:
    python webcam_mode.py [--duration 30] [--fps 10] [--camera 0]
"""

import argparse
import json
import sys
import time

import cv2

from config import PRESAGE_API_KEY
from preprocessing import FrameProcessor
from presage_client import PresageClient
from phone_detector import PhoneDetector


def capture_and_process(duration: int = 30, fps: float = 10.0, camera_index: int = 0):
    """Capture webcam frames, preprocess, upload, and display results."""
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print(f"ERROR: Cannot open camera {camera_index}")
        sys.exit(1)

    actual_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    print(f"Camera opened. Native FPS: {actual_fps}")
    print(f"Recording for {duration}s at ~{fps} effective FPS...")
    print("Press 'q' to stop early.\n")

    processor = FrameProcessor(fps=fps)
    phone_detector = PhoneDetector(fps=fps)
    frame_interval = 1.0 / fps
    start_time = time.time()
    last_capture = 0
    frames_captured = 0

    while True:
        elapsed = time.time() - start_time
        if elapsed >= duration:
            break

        ret, frame = cap.read()
        if not ret:
            print("WARNING: Failed to read frame")
            continue

        # Throttle to target FPS
        if elapsed - last_capture < frame_interval:
            # Show preview but don't process
            cv2.imshow("Presage Webcam - Press Q to stop", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            continue

        last_capture = elapsed
        processor.process_frame(frame)
        phone_result = phone_detector.detect(frame, elapsed)
        frames_captured += 1

        # Show progress with phone status
        remaining = duration - int(elapsed)
        phone_status = ""
        if phone_result["phone_detected"]:
            phone_status = f" | PHONE: {phone_result['posture'].upper()}"
        sys.stdout.write(f"\rFrames: {frames_captured} | Time remaining: {remaining}s{phone_status}  ")
        sys.stdout.flush()

        cv2.imshow("Presage Webcam - Press Q to stop", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    print(f"\n\nCapture complete. {frames_captured} frames collected.")

    if frames_captured < 10:
        print("ERROR: Too few frames captured. Need at least 10 for meaningful results.")
        sys.exit(1)

    # Upload and get results
    print("Preprocessing and uploading to Presage API...")
    client = PresageClient()
    compressed = processor.get_compressed_trace()
    print(f"Trace size: {len(compressed)} bytes (compressed)")

    phone_summary = phone_detector.get_summary()

    try:
        results = client.process_and_get_results(compressed, process_type="all", timeout=300)
        print_results(results, phone_summary)
    except Exception as e:
        print(f"ERROR: {e}")
        # Still print phone detection even if Presage API fails
        print_phone_results(phone_summary)
        sys.exit(1)


def print_phone_results(phone_summary: dict):
    """Print phone detection results."""
    print("\n" + "-" * 60)
    print("  PHONE DETECTION")
    print("-" * 60)
    if phone_summary["on_phone"]:
        print(f"  Phone Usage Detected: YES")
        print(f"  Total Phone Time: {phone_summary['total_phone_seconds']}s")
        for ev in phone_summary["events"]:
            print(f"    {ev['start']}s - {ev['end']}s  ({ev['type']}, {ev['duration']}s)")
    else:
        print(f"  Phone Usage Detected: NO")
    print("-" * 60)


def print_results(results: dict, phone_summary: dict = None):
    """Pretty-print vitals results to terminal."""
    print("\n" + "=" * 60)
    print("  PRESAGE VITALS RESULTS")
    print("=" * 60)

    if not results:
        print("No results returned.")
        return

    vitals_keys = {
        "heart_rate": ("Heart Rate", "bpm"),
        "hr": ("Heart Rate", "bpm"),
        "pulse_rate": ("Pulse Rate", "bpm"),
        "respiratory_rate": ("Respiratory Rate", "breaths/min"),
        "rr": ("Respiratory Rate", "breaths/min"),
        "breathing_rate": ("Breathing Rate", "breaths/min"),
        "spo2": ("Blood Oxygen (SpO2)", "%"),
        "oxygen_saturation": ("Blood Oxygen (SpO2)", "%"),
        "hrv": ("Heart Rate Variability", "ms"),
        "heart_rate_variability": ("Heart Rate Variability", "ms"),
        "stress_level": ("Stress Level", ""),
        "blood_pressure_systolic": ("Blood Pressure (Systolic)", "mmHg"),
        "blood_pressure_diastolic": ("Blood Pressure (Diastolic)", "mmHg"),
        "breathing_amplitude": ("Breathing Amplitude", ""),
        "inhale_exhale_ratio": ("Inhale/Exhale Ratio", ""),
        "apnea": ("Apnea Detected", ""),
        "respiratory_line_length": ("Respiratory Line Length", ""),
        "phasic_eda": ("Phasic EDA", ""),
        "cardiac_stress": ("Cardiac Stress", ""),
    }

    # Handle nested result structures
    data = results.get("data", results)

    printed_any = False
    for key, value in flatten_dict(data):
        key_lower = key.lower().replace("-", "_").replace(" ", "_")
        if key_lower in vitals_keys:
            label, unit = vitals_keys[key_lower]
            unit_str = f" {unit}" if unit else ""
            if isinstance(value, float):
                print(f"  {label}: {value:.1f}{unit_str}")
            else:
                print(f"  {label}: {value}{unit_str}")
            printed_any = True

    if not printed_any:
        # Just dump what we got
        print("\nRaw API Response:")
        print(json.dumps(data, indent=2, default=str)[:3000])

    print("=" * 60)

    if phone_summary:
        print_phone_results(phone_summary)


def flatten_dict(d, parent_key=""):
    """Flatten a nested dict for easy key scanning."""
    items = []
    if isinstance(d, dict):
        for k, v in d.items():
            new_key = k if not parent_key else f"{parent_key}_{k}"
            if isinstance(v, dict):
                items.extend(flatten_dict(v, new_key))
            elif isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                for item in v:
                    items.extend(flatten_dict(item, new_key))
            else:
                items.append((k, v))
    return items


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Presage Webcam Mode")
    parser.add_argument("--duration", type=int, default=30, help="Recording duration in seconds (default: 30)")
    parser.add_argument("--fps", type=float, default=10.0, help="Target frames per second (default: 10)")
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default: 0)")
    args = parser.parse_args()

    if not PRESAGE_API_KEY:
        print("ERROR: Set PRESAGE_API_KEY in .env file")
        sys.exit(1)

    capture_and_process(duration=args.duration, fps=args.fps, camera_index=args.camera)
