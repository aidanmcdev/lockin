"""
Presage API Server - Production mode.

Accepts video snippets via HTTP, processes them through the SmartSpectra C++ SDK,
and returns vitals data (heart rate, breathing rate, etc.).

The C++ SDK handles all preprocessing and Presage API communication internally.

Endpoints:
    POST /api/process-video    - Send a video file (async, returns job_id)
    POST /api/process-sync     - Send a video file (blocks until results)
    POST /api/process-frames   - Send multiple frames as images (converted to video)
    GET  /api/status/<id>      - Check processing status / get results
    GET  /api/jobs             - List all jobs
    GET  /health               - Health check
"""

import base64
import json
import logging
import os
import subprocess
import tempfile
import threading
import time
import uuid

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS

from config import HOST, PORT, PRESAGE_API_KEY, SMARTSPECTRA_BIN

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s [Server] %(message)s",
    level=logging.INFO,
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = Flask(__name__)
CORS(app)

# Path to the compiled C++ binary
EXTRACT_VITALS_BIN = SMARTSPECTRA_BIN

# In-memory job store
jobs = {}
jobs_lock = threading.Lock()


def decode_image(data: bytes) -> np.ndarray:
    """Decode image bytes to BGR numpy array."""
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image")
    return frame


def frames_to_video(frames: list, fps: float) -> str:
    """Write frames to a temporary video file. Returns the file path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()

    h, w = frames[0].shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(tmp.name, fourcc, fps, (w, h))

    for frame in frames:
        writer.write(frame)
    writer.release()

    return tmp.name


def run_extract_vitals(video_path: str, api_key: str, timeout: int = 600) -> dict:
    """Run the SmartSpectra C++ binary on a video file and return parsed JSON results."""
    if not os.path.exists(EXTRACT_VITALS_BIN):
        raise FileNotFoundError(
            f"SmartSpectra binary not found at {EXTRACT_VITALS_BIN}. "
            "Run: cd smartspectra && mkdir build && cd build && cmake .. && make"
        )

    env = os.environ.copy()
    env["SMARTSPECTRA_API_KEY"] = api_key

    logging.info(f"Running SmartSpectra on {video_path}")
    result = subprocess.run(
        [
            EXTRACT_VITALS_BIN,
            f"--input_video_path={video_path}",
            f"--api_key={api_key}",
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )

    # Log stderr (progress info from the C++ binary)
    if result.stderr:
        for line in result.stderr.strip().split("\n"):
            logging.info(f"[SmartSpectra] {line}")

    if result.returncode not in (0, 2):
        raise RuntimeError(f"SmartSpectra exited with code {result.returncode}: {result.stderr}")

    # Parse JSON from stdout
    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError("SmartSpectra produced no output")

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"SmartSpectra output not valid JSON: {stdout[:500]}")


def process_video_async(job_id: str, video_path: str, api_key: str, cleanup: bool = True):
    """Background thread: run SmartSpectra on video file."""
    try:
        with jobs_lock:
            jobs[job_id]["status"] = "processing"

        results = run_extract_vitals(video_path, api_key)

        with jobs_lock:
            jobs[job_id]["status"] = "complete"
            jobs[job_id]["results"] = results

    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}")
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(e)
    finally:
        if cleanup and os.path.exists(video_path):
            os.unlink(video_path)


def save_uploaded_video(video_file) -> tuple:
    """Save uploaded video to temp file, return (path, native_fps, frame_count)."""
    suffix = os.path.splitext(video_file.filename or "video.mp4")[1]
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    video_file.save(tmp.name)
    tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    if not cap.isOpened():
        os.unlink(tmp.name)
        raise ValueError("Could not open video file")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    return tmp.name, native_fps, frame_count


@app.route("/health", methods=["GET"])
def health():
    sdk_ready = os.path.exists(EXTRACT_VITALS_BIN)
    return jsonify({
        "status": "ok",
        "service": "presage-api",
        "sdk": "smartspectra-cpp",
        "sdk_binary_found": sdk_ready,
    })


@app.route("/api/process-video", methods=["POST"])
def process_video():
    """Accept a video file and process asynchronously."""
    video_file = request.files.get("video")
    if not video_file:
        return jsonify({"error": "No video file. Send as 'video' multipart field."}), 400

    api_key = request.form.get("api_key", PRESAGE_API_KEY)
    if not api_key:
        return jsonify({"error": "No API key configured."}), 401

    try:
        video_path, native_fps, frame_count = save_uploaded_video(video_file)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if frame_count < 5:
        os.unlink(video_path)
        return jsonify({"error": f"Video too short ({frame_count} frames), need at least 5."}), 400

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "frame_count": frame_count,
            "native_fps": native_fps,
        }

    thread = threading.Thread(target=process_video_async, args=(job_id, video_path, api_key))
    thread.daemon = True
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "frame_count": frame_count,
        "message": f"Processing video ({frame_count} frames). Poll /api/status/{job_id} for results.",
    }), 202


@app.route("/api/process-frames", methods=["POST"])
def process_frames():
    """Accept multiple image files, assemble into video, process."""
    files = request.files.getlist("frames")
    if not files:
        return jsonify({"error": "No frames provided. Send images as 'frames' multipart field."}), 400

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

    # Convert frames to a temp video for the C++ SDK
    video_path = frames_to_video(frames, fps)

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "frame_count": len(frames),
            "fps": fps,
        }

    thread = threading.Thread(target=process_video_async, args=(job_id, video_path, api_key))
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
    """Accept base64-encoded frames as JSON, assemble into video, process."""
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

    video_path = frames_to_video(frames, fps)

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "frame_count": len(frames),
            "fps": fps,
        }

    thread = threading.Thread(target=process_video_async, args=(job_id, video_path, api_key))
    thread.daemon = True
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "frame_count": len(frames),
        "message": f"Processing {len(frames)} frames. Poll /api/status/{job_id} for results.",
    }), 202


@app.route("/api/process-sync", methods=["POST"])
def process_sync():
    """Synchronous endpoint - send video or frames, wait for results."""
    video_file = request.files.get("video")
    video_path = None
    frame_count = 0

    api_key = request.form.get("api_key", PRESAGE_API_KEY)
    if not api_key:
        return jsonify({"error": "No API key configured."}), 401

    if video_file:
        try:
            video_path, native_fps, frame_count = save_uploaded_video(video_file)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    else:
        # Fall back to image frames
        files = request.files.getlist("frames")
        if not files:
            return jsonify({"error": "No frames or video provided."}), 400

        fps = float(request.form.get("fps", 10.0))
        frames = []
        for f in files:
            try:
                frame = decode_image(f.read())
                frames.append(frame)
            except ValueError as e:
                return jsonify({"error": f"Failed to decode image: {e}"}), 400

        if len(frames) < 5:
            return jsonify({"error": f"Need at least 5 frames, got {len(frames)}"}), 400

        video_path = frames_to_video(frames, fps)
        frame_count = len(frames)

    try:
        results = run_extract_vitals(video_path, api_key)
        return jsonify({
            "status": results.get("status", "complete"),
            "results": results,
            "frames_processed": frame_count,
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500
    finally:
        if video_path and os.path.exists(video_path):
            os.unlink(video_path)


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
    if not os.path.exists(EXTRACT_VITALS_BIN):
        logging.warning(f"SmartSpectra binary not found at {EXTRACT_VITALS_BIN}")
        logging.warning("Build it: cd smartspectra && mkdir build && cd build && cmake .. && make")
    logging.info(f"Starting Presage API server on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
