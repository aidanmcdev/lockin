"""
Presage API Server - Production mode.

Accepts video snippets via HTTP or real-time frame streams via WebSocket,
processes them through the SmartSpectra C++ SDK, and returns vitals data.

HTTP Endpoints:
    POST /api/process-video    - Send a video file (async, returns job_id)
    POST /api/process-sync     - Send a video file (blocks until results)
    POST /api/process-frames   - Send multiple frames as images (converted to video)
    GET  /api/status/<id>      - Check processing status / get results
    GET  /api/jobs             - List all jobs
    GET  /health               - Health check

WebSocket Events (via socket.io):
    start_stream               - Begin real-time frame streaming
    frame                      - Send a JPEG frame
    stop_stream                - End streaming, get final results
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
from flask_socketio import SocketIO, emit

from config import HOST, PORT, PRESAGE_API_KEY, SMARTSPECTRA_BIN
from attentiveness import compute_attentiveness
from stream_session import StreamSession

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s [Server] %(message)s",
    level=logging.INFO,
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Path to the compiled C++ binary
EXTRACT_VITALS_BIN = SMARTSPECTRA_BIN

# In-memory job store
jobs = {}
jobs_lock = threading.Lock()

# Active streaming sessions (sid -> StreamSession)
stream_sessions = {}
stream_sessions_lock = threading.Lock()


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


CONVERTIBLE_FORMATS = {".webm", ".mkv", ".avi", ".flv", ".wmv", ".mov", ".ts", ".m4v"}


def convert_to_mp4(video_path: str) -> str:
    """Convert non-mp4 video to mp4 using ffmpeg. Returns new path (or original if already mp4)."""
    ext = os.path.splitext(video_path)[1].lower()
    if ext not in CONVERTIBLE_FORMATS:
        return video_path

    mp4_path = video_path.rsplit(".", 1)[0] + ".mp4"
    logging.info(f"Converting {ext} to mp4: {video_path} -> {mp4_path}")

    result = subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", mp4_path],
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        logging.error(f"ffmpeg conversion failed: {result.stderr[-500:]}")
        raise RuntimeError(f"Failed to convert {ext} to mp4: {result.stderr[-200:]}")

    # Remove original
    os.unlink(video_path)
    logging.info(f"Conversion complete: {mp4_path}")
    return mp4_path


def run_extract_vitals(video_path: str, api_key: str, timeout: int = 600) -> dict:
    """Run the SmartSpectra C++ binary on a video file and return parsed JSON results."""
    # Auto-convert non-mp4 formats
    video_path = convert_to_mp4(video_path)

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
        raw = json.loads(stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"SmartSpectra output not valid JSON: {stdout[:500]}")

    return extract_vitals_summary(raw)


def _extract_from_snapshot(snapshot: dict) -> dict:
    """Extract vitals from a single SDK metrics snapshot."""
    vitals = {}

    # Pulse rate
    pulse = snapshot.get("pulse", {})
    rate_list = pulse.get("rate", [])
    if rate_list:
        vitals["pulse_rate_bpm"] = rate_list[-1].get("value")
        # Confidence
        rate_conf = pulse.get("rateConfidence", [])
        if rate_conf:
            vitals["pulse_rate_confidence"] = rate_conf[-1].get("value")

    # HRV — could be under several keys
    for hrv_key in ("hrv", "heartRateVariability", "pulseRateVariability"):
        hrv_data = pulse.get(hrv_key, {})
        if isinstance(hrv_data, list) and hrv_data:
            vitals["hrv_ms"] = hrv_data[-1].get("value")
            break
        elif isinstance(hrv_data, dict):
            for sub_key in ("sdnn", "rmssd", "value", "index"):
                sub = hrv_data.get(sub_key, [])
                if isinstance(sub, list) and sub:
                    vitals["hrv_ms"] = sub[-1].get("value")
                    break
                elif isinstance(sub, (int, float)) and sub > 0:
                    vitals["hrv_ms"] = sub
                    break
            if "hrv_ms" in vitals:
                break

    # Breathing rate
    breathing = snapshot.get("breathing", {})
    br_list = breathing.get("rate", [])
    if br_list:
        vitals["breathing_rate_bpm"] = br_list[-1].get("value")
        br_conf = breathing.get("rateConfidence", [])
        if br_conf:
            vitals["breathing_rate_confidence"] = br_conf[-1].get("value")

    # Stress index
    for stress_key in ("stress", "stressIndex", "ansIndex"):
        stress = snapshot.get(stress_key)
        if stress is None:
            continue
        if isinstance(stress, dict):
            for sub_key in ("value", "index", "level"):
                sv = stress.get(sub_key, [])
                if isinstance(sv, list) and sv:
                    vitals["stress_index"] = sv[-1].get("value")
                    break
                elif isinstance(sv, (int, float)):
                    vitals["stress_index"] = sv
                    break
        elif isinstance(stress, list) and stress:
            vitals["stress_index"] = stress[-1].get("value")
        if "stress_index" in vitals:
            break

    return vitals


def extract_vitals_summary(raw: dict) -> dict:
    """Parse SDK output, scan ALL snapshots for the best vitals data."""
    if raw.get("status") != "complete":
        return raw

    all_snapshots = raw.get("all_snapshots", [])
    latest = raw.get("latest", {})

    # Scan all snapshots for the one with the most vitals populated
    best_vitals = {}
    best_score = 0

    candidates = all_snapshots if all_snapshots else [latest]
    for snap in candidates:
        v = _extract_from_snapshot(snap)
        score = sum(1 for val in v.values() if val is not None)
        if score > best_score:
            best_score = score
            best_vitals = v

    # Fill in defaults for missing fields
    result_vitals = {
        "pulse_rate_bpm": best_vitals.get("pulse_rate_bpm"),
        "breathing_rate_bpm": best_vitals.get("breathing_rate_bpm"),
        "hrv_ms": best_vitals.get("hrv_ms"),
        "stress_index": best_vitals.get("stress_index"),
    }

    # Add confidence if available
    if "pulse_rate_confidence" in best_vitals:
        result_vitals["pulse_rate_confidence"] = best_vitals["pulse_rate_confidence"]
    if "breathing_rate_confidence" in best_vitals:
        result_vitals["breathing_rate_confidence"] = best_vitals["breathing_rate_confidence"]

    # Metadata from latest
    meta = latest.get("metadata", {})

    # Check if we got any actual data
    has_data = any(v is not None for v in result_vitals.values())

    # Compute attentiveness score from all snapshots
    attentiveness = compute_attentiveness(candidates, meta)

    return {
        "status": "complete" if has_data else "insufficient_data",
        "vitals": result_vitals,
        "attentiveness": attentiveness,
        "metadata": {
            "api_version": meta.get("apiVersion"),
            "video_id": meta.get("id"),
            "frame_count": meta.get("frameCount"),
        },
        "snapshot_count": raw.get("snapshot_count", 1),
        "message": None if has_data else "Video may be too short. Use 30+ seconds with a clear, steady face.",
    }


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
    """Save uploaded video to temp file, convert if needed, return (path, native_fps, frame_count)."""
    suffix = os.path.splitext(video_file.filename or "video.mp4")[1]
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    video_file.save(tmp.name)
    tmp.close()

    # Convert non-mp4 formats (webm, mkv, etc.) to mp4 via ffmpeg
    video_path = convert_to_mp4(tmp.name)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        os.unlink(video_path)
        raise ValueError("Could not open video file")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    return video_path, native_fps, frame_count


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


# ============================================================================
# WebSocket streaming endpoints
# ============================================================================

@socketio.on("connect")
def ws_connect():
    logging.info(f"WebSocket client connected: {request.sid}")


@socketio.on("disconnect")
def ws_disconnect():
    sid = request.sid
    logging.info(f"WebSocket client disconnected: {sid}")
    with stream_sessions_lock:
        session = stream_sessions.pop(sid, None)
    if session:
        session.cleanup()


@socketio.on("start_stream")
def ws_start_stream(data):
    """Start a real-time streaming session."""
    sid = request.sid
    fps = float(data.get("fps", 5.0)) if data else 5.0
    api_key = (data.get("api_key") if data else None) or PRESAGE_API_KEY

    if not api_key:
        emit("error", {"message": "No API key configured."})
        return

    if not os.path.exists(EXTRACT_VITALS_BIN):
        emit("error", {"message": "SmartSpectra binary not found on server."})
        return

    # Cleanup any existing session for this client
    with stream_sessions_lock:
        old = stream_sessions.pop(sid, None)
    if old:
        old.cleanup()

    session = StreamSession(sid=sid, api_key=api_key, fps=fps)

    # Set up callbacks that emit back to this specific client
    def on_vitals(payload):
        socketio.emit("vitals_update", payload, to=sid)

    def on_attentiveness(payload):
        socketio.emit("attentiveness_update", payload, to=sid)

    def on_error(message):
        socketio.emit("error", {"message": message}, to=sid)

    session.set_callbacks(
        on_vitals=on_vitals,
        on_attentiveness=on_attentiveness,
        on_error=on_error,
    )

    with stream_sessions_lock:
        stream_sessions[sid] = session

    try:
        session.start()
        emit("stream_started", {"session_id": session.session_id})
        logging.info(f"Stream started for {sid}, session {session.session_id}")
    except Exception as e:
        logging.error(f"Failed to start stream for {sid}: {e}")
        emit("error", {"message": str(e)})
        with stream_sessions_lock:
            stream_sessions.pop(sid, None)
        session.cleanup()


@socketio.on("frame")
def ws_frame(data):
    """Receive a JPEG frame from the client."""
    sid = request.sid
    with stream_sessions_lock:
        session = stream_sessions.get(sid)

    if not session:
        emit("error", {"message": "No active stream. Call start_stream first."})
        return

    # data can be base64 string or binary
    if isinstance(data, dict):
        frame_data = data.get("data", "")
        if isinstance(frame_data, str):
            frame_data = base64.b64decode(frame_data)
    elif isinstance(data, bytes):
        frame_data = data
    elif isinstance(data, str):
        frame_data = base64.b64decode(data)
    else:
        emit("error", {"message": "Invalid frame data format."})
        return

    session.write_frame(frame_data)


@socketio.on("stop_stream")
def ws_stop_stream():
    """Stop the streaming session and get final results."""
    sid = request.sid
    with stream_sessions_lock:
        session = stream_sessions.pop(sid, None)

    if not session:
        emit("error", {"message": "No active stream."})
        return

    session.stop()
    final = session.get_final_results()
    emit("stream_stopped", {"final_results": final})
    logging.info(f"Stream stopped for {sid}: {final.get('snapshot_count', 0)} snapshots, "
                 f"{final.get('frames_sent', 0)} frames")
    session.cleanup()


if __name__ == "__main__":
    if not PRESAGE_API_KEY:
        logging.warning("PRESAGE_API_KEY not set! Set it in .env or pass per-request.")
    if not os.path.exists(EXTRACT_VITALS_BIN):
        logging.warning(f"SmartSpectra binary not found at {EXTRACT_VITALS_BIN}")
        logging.warning("Build it: cd smartspectra && mkdir build && cd build && cmake .. && make")
    logging.info(f"Starting Presage API server on {HOST}:{PORT}")
    socketio.run(app, host=HOST, port=int(PORT), debug=False, allow_unsafe_werkzeug=True)
