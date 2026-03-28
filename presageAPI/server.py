#!/usr/bin/env python3
"""
Presage API Server - Production mode.

Accepts frames/images via HTTP, preprocesses them, sends to Presage API,
and returns vitals data.

Endpoints:
    POST /api/process-frames   - Send multiple frames as multipart images
    POST /api/process-video    - Send a video file
    POST /api/process-base64   - Send base64-encoded frames as JSON
    GET  /api/status/<id>      - Check processing status / get results
    GET  /health               - Health check
"""

import base64
import io
import json
import logging
import os
import tempfile
import threading
import time
import uuid

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS

from config import HOST, PORT, PRESAGE_API_KEY
from preprocessing import FrameProcessor
from presage_client import PresageClient

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s [Server] %(message)s",
    level=logging.INFO,
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = Flask(__name__)
CORS(app)

# In-memory job store (for free-tier EC2, keep it simple)
jobs = {}
jobs_lock = threading.Lock()


def decode_image(data: bytes) -> np.ndarray:
    """Decode image bytes to BGR numpy array."""
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image")
    return frame


def process_frames_async(job_id: str, frames: list, fps: float, api_key: str):
    """Background thread: preprocess frames, upload, poll for results."""
    try:
        with jobs_lock:
            jobs[job_id]["status"] = "preprocessing"

        processor = FrameProcessor(fps=fps)
        for frame in frames:
            processor.process_frame(frame)

        with jobs_lock:
            jobs[job_id]["status"] = "uploading"
            jobs[job_id]["frames_processed"] = len(frames)

        client = PresageClient(api_key=api_key)
        compressed = processor.get_compressed_trace()

        with jobs_lock:
            jobs[job_id]["trace_size_bytes"] = len(compressed)
            jobs[job_id]["status"] = "processing"

        results = client.process_and_get_results(compressed, process_type="all", timeout=300)

        with jobs_lock:
            jobs[job_id]["status"] = "complete"
            jobs[job_id]["results"] = results

    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}")
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(e)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "presage-api"})


@app.route("/api/process-frames", methods=["POST"])
def process_frames():
    """Accept multiple image files as multipart form data.

    Form fields:
        frames: multiple image files
        fps: optional, target FPS (default 10)
        api_key: optional, override default API key
    """
    files = request.files.getlist("frames")
    if not files:
        return jsonify({"error": "No frames provided. Send images as 'frames' multipart field."}), 400

    fps = float(request.form.get("fps", 10.0))
    api_key = request.form.get("api_key", PRESAGE_API_KEY)

    if not api_key:
        return jsonify({"error": "No API key. Set PRESAGE_API_KEY in .env or pass api_key in form data."}), 401

    frames = []
    for f in files:
        try:
            frame = decode_image(f.read())
            frames.append(frame)
        except ValueError as e:
            return jsonify({"error": f"Failed to decode image: {e}"}), 400

    if len(frames) < 5:
        return jsonify({"error": f"Need at least 5 frames, got {len(frames)}"}), 400

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "frame_count": len(frames),
            "fps": fps,
        }

    thread = threading.Thread(target=process_frames_async, args=(job_id, frames, fps, api_key))
    thread.daemon = True
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "frame_count": len(frames),
        "message": f"Processing {len(frames)} frames. Poll /api/status/{job_id} for results.",
    }), 202


@app.route("/api/process-base64", methods=["POST"])
def process_base64():
    """Accept base64-encoded frames as JSON.

    JSON body:
        {
            "frames": ["base64_string_1", "base64_string_2", ...],
            "fps": 10,
            "api_key": "optional_override"
        }
    """
    data = request.get_json()
    if not data or "frames" not in data:
        return jsonify({"error": "JSON body with 'frames' array of base64 strings required."}), 400

    fps = float(data.get("fps", 10.0))
    api_key = data.get("api_key", PRESAGE_API_KEY)

    if not api_key:
        return jsonify({"error": "No API key configured."}), 401

    frames = []
    for i, b64 in enumerate(data["frames"]):
        try:
            img_bytes = base64.b64decode(b64)
            frame = decode_image(img_bytes)
            frames.append(frame)
        except Exception as e:
            return jsonify({"error": f"Failed to decode frame {i}: {e}"}), 400

    if len(frames) < 5:
        return jsonify({"error": f"Need at least 5 frames, got {len(frames)}"}), 400

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "frame_count": len(frames),
            "fps": fps,
        }

    thread = threading.Thread(target=process_frames_async, args=(job_id, frames, fps, api_key))
    thread.daemon = True
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "frame_count": len(frames),
        "message": f"Processing {len(frames)} frames. Poll /api/status/{job_id} for results.",
    }), 202


@app.route("/api/process-video", methods=["POST"])
def process_video():
    """Accept a video file, extract frames, preprocess, and process.

    Form fields:
        video: video file (mp4, avi, mov)
        fps: optional target FPS (default 10)
        api_key: optional override
    """
    video_file = request.files.get("video")
    if not video_file:
        return jsonify({"error": "No video file. Send as 'video' multipart field."}), 400

    fps = float(request.form.get("fps", 10.0))
    api_key = request.form.get("api_key", PRESAGE_API_KEY)

    if not api_key:
        return jsonify({"error": "No API key configured."}), 401

    # Save to temp file
    suffix = os.path.splitext(video_file.filename or "video.mp4")[1]
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    video_file.save(tmp.name)
    tmp.close()

    # Extract frames
    cap = cv2.VideoCapture(tmp.name)
    if not cap.isOpened():
        os.unlink(tmp.name)
        return jsonify({"error": "Could not open video file."}), 400

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
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
    os.unlink(tmp.name)

    if len(frames) < 5:
        return jsonify({"error": f"Video too short. Extracted {len(frames)} frames, need at least 5."}), 400

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "frame_count": len(frames),
            "fps": fps,
            "source": "video",
            "native_fps": native_fps,
            "total_video_frames": total_frames,
        }

    thread = threading.Thread(target=process_frames_async, args=(job_id, frames, fps, api_key))
    thread.daemon = True
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "frame_count": len(frames),
        "video_fps": native_fps,
        "message": f"Processing {len(frames)} frames from video. Poll /api/status/{job_id} for results.",
    }), 202


@app.route("/api/process-sync", methods=["POST"])
def process_sync():
    """Synchronous endpoint - send frames, wait for results.

    Same inputs as /api/process-frames but blocks until complete.
    Only use for small batches; will timeout on large ones.
    """
    files = request.files.getlist("frames")
    if not files:
        return jsonify({"error": "No frames provided."}), 400

    fps = float(request.form.get("fps", 10.0))
    api_key = request.form.get("api_key", PRESAGE_API_KEY)

    if not api_key:
        return jsonify({"error": "No API key configured."}), 401

    frames = []
    for f in files:
        try:
            frame = decode_image(f.read())
            frames.append(frame)
        except ValueError as e:
            return jsonify({"error": f"Failed to decode image: {e}"}), 400

    if len(frames) < 5:
        return jsonify({"error": f"Need at least 5 frames, got {len(frames)}"}), 400

    processor = FrameProcessor(fps=fps)
    for frame in frames:
        processor.process_frame(frame)

    client = PresageClient(api_key=api_key)
    compressed = processor.get_compressed_trace()

    try:
        results = client.process_and_get_results(compressed, process_type="all", timeout=300)
        return jsonify({"status": "complete", "results": results})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/status/<job_id>", methods=["GET"])
def get_status(job_id):
    """Check job status and get results when complete."""
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": f"Job {job_id} not found."}), 404
    return jsonify({"job_id": job_id, **job})


@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    """List all jobs."""
    with jobs_lock:
        summary = {
            jid: {"status": j["status"], "created_at": j.get("created_at")}
            for jid, j in jobs.items()
        }
    return jsonify(summary)


if __name__ == "__main__":
    if not PRESAGE_API_KEY:
        logging.warning("PRESAGE_API_KEY not set! Set it in .env or pass per-request.")
    logging.info(f"Starting Presage API server on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
