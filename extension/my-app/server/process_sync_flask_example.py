"""
Reference handler for POST /api/process-sync (multipart fields: "video", "fps").

Error {"error":"Could not open video file"} usually means:
  - OpenCV was built without WebM/FFmpeg, or
  - cv2.VideoCapture needs CAP_FFMPEG for .webm, or
  - The upload was saved with the wrong extension.

Browser MediaRecorder sends WebM (VP8/VP9). Install system ffmpeg and use CAP_FFMPEG.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

try:
    import cv2
except ImportError:
    cv2 = None  # type: ignore


def open_video_capture(path: str):
    """Open with FFmpeg backend first — required for most browser WebM."""
    if cv2 is None:
        raise RuntimeError("Install opencv-python-headless and system ffmpeg")

    # Explicit backend: cv2.CAP_FFMPEG (numeric 1900 if the attribute is missing)
    if hasattr(cv2, "CAP_FFMPEG"):
        cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    else:
        cap = cv2.VideoCapture(path, 1900)

    if cap.isOpened():
        return cap
    cap.release()

    # Fallback: default backend (sometimes helps for MP4/MOV)
    cap = cv2.VideoCapture(path)
    if cap.isOpened():
        return cap
    cap.release()
    return None


@app.post("/api/process-sync")
def process_sync():
    upload = request.files.get("video")
    if upload is None or upload.filename == "":
        return jsonify(error="Missing multipart field 'video'"), 400

    fps_form = request.form.get("fps")
    client_fps = None
    if fps_form is not None and str(fps_form).strip() != "":
        try:
            client_fps = float(str(fps_form).strip())
        except ValueError:
            client_fps = None

    # Preserve browser suffix; default .webm for MediaRecorder
    original = upload.filename or "segment.webm"
    suffix = Path(original).suffix.lower() or ".webm"
    if suffix not in {".webm", ".mkv", ".mp4", ".avi", ".mov"}:
        suffix = ".webm"

    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        upload.save(tmp_path)

        if os.path.getsize(tmp_path) < 32:
            return jsonify(error="Uploaded file is empty or truncated"), 400

        cap = open_video_capture(tmp_path)
        if cap is None:
            return (
                jsonify(
                    error="Could not open video file",
                    hint=(
                        "Install ffmpeg (macOS: brew install ffmpeg; Ubuntu: sudo apt install ffmpeg), "
                        "then ensure this file uses cv2.VideoCapture(path, cv2.CAP_FFMPEG). "
                        "Or transcode: ffmpeg -y -i in.webm -c copy out.mkv"
                    ),
                ),
                400,
            )

        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        cap.release()

        # Replace with your vitals / attentiveness pipeline.
        # `client_fps` is from multipart field "fps" (camera track); `fps` is from the container.
        return jsonify(
            ok=True,
            attentiveness=0.85,
            vitals={
                "heart_rate_bpm": 72,
                "frames_seen": frame_count,
                "container_fps": fps,
                "client_reported_fps": client_fps,
            },
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    if shutil.which("ffmpeg") is None:
        print("Warning: ffmpeg not found on PATH — WebM often fails without it.")
    app.run(host="0.0.0.0", port=5000, debug=True)
