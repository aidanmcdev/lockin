"""
Manages a real-time streaming session between a WebSocket client and the SmartSpectra C++ SDK.

Each session:
1. Creates a temp directory for frames
2. Spawns the extract_vitals binary in file_stream mode
3. Reads JSON lines from its stdout as metrics arrive
4. Emits vitals and attentiveness back via socketio
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

from config import PRESAGE_API_KEY, SMARTSPECTRA_BIN
from attentiveness import compute_attentiveness

logger = logging.getLogger(__name__)

ATTENTIVENESS_MIN_ELAPSED_S = 30.0
ATTENTIVENESS_UPDATE_INTERVAL_S = 10.0


class StreamSession:
    def __init__(self, sid: str, api_key: str = "", fps: float = 5.0):
        self.sid = sid
        self.session_id = str(uuid.uuid4())[:8]
        self.api_key = api_key or PRESAGE_API_KEY
        self.fps = fps

        # Frame directory for file_stream mode
        self.frame_dir = tempfile.mkdtemp(prefix=f"presage_stream_{self.session_id}_")
        self.frame_index = 0
        self.start_time = time.time()

        # SmartSpectra process
        self.process = None
        self.reader_thread = None
        self.running = False

        # Collected data
        self.snapshots = []
        self.latest_vitals = None
        self.latest_attentiveness = None
        self.last_attentiveness_time = 0.0

        # Callback for emitting events
        self._on_vitals = None
        self._on_attentiveness = None
        self._on_error = None

        logger.info(f"Session {self.session_id} created for SID {sid}, frames dir: {self.frame_dir}")

    def set_callbacks(self, on_vitals=None, on_attentiveness=None, on_error=None):
        self._on_vitals = on_vitals
        self._on_attentiveness = on_attentiveness
        self._on_error = on_error

    def start(self):
        """Spawn the SmartSpectra process in file_stream mode."""
        if not os.path.exists(SMARTSPECTRA_BIN):
            raise FileNotFoundError(f"SmartSpectra binary not found at {SMARTSPECTRA_BIN}")

        env = os.environ.copy()
        env["SMARTSPECTRA_API_KEY"] = self.api_key

        cmd = [
            SMARTSPECTRA_BIN,
            f"--file_stream_path={self.frame_dir}/",
            f"--api_key={self.api_key}",
            "--stream",
        ]

        logger.info(f"Session {self.session_id}: starting SmartSpectra with file_stream")
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )

        self.running = True
        self.start_time = time.time()

        # Thread to read stdout JSON lines
        self.reader_thread = threading.Thread(
            target=self._read_stdout, daemon=True
        )
        self.reader_thread.start()

        # Thread to read stderr (logs)
        self.stderr_thread = threading.Thread(
            target=self._read_stderr, daemon=True
        )
        self.stderr_thread.start()

    def write_frame(self, jpeg_data: bytes):
        """Write a JPEG frame to the stream directory as a numbered PNG."""
        if not self.running:
            return

        # Timestamp in microseconds (SDK expects zero-padded microsecond timestamps)
        timestamp_us = int((time.time() - self.start_time) * 1_000_000)

        # SDK expects: frame{timestamp}.png with zero-padded digits matching the template
        # Template is "frame0000000000000.png" = 13 digits
        filename = f"frame{timestamp_us:013d}.png"
        filepath = os.path.join(self.frame_dir, filename)

        # Convert JPEG to PNG (SDK expects PNG based on template extension)
        import cv2
        import numpy as np
        arr = np.frombuffer(jpeg_data, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is not None:
            cv2.imwrite(filepath, frame)
            self.frame_index += 1
        else:
            logger.warning(f"Session {self.session_id}: failed to decode frame {self.frame_index}")

    def stop(self):
        """Signal end of stream and wait for final results."""
        if not self.running:
            return

        logger.info(f"Session {self.session_id}: stopping stream")

        # Write end_of_stream sentinel file
        sentinel = os.path.join(self.frame_dir, "end_of_stream")
        with open(sentinel, "w") as f:
            f.write("")

        self.running = False

        # Wait for process to finish (with timeout)
        if self.process:
            try:
                self.process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                logger.warning(f"Session {self.session_id}: process timed out, killing")
                self.process.kill()

    def cleanup(self):
        """Kill process and remove temp directory."""
        self.running = False

        if self.process and self.process.poll() is None:
            self.process.kill()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

        if os.path.exists(self.frame_dir):
            shutil.rmtree(self.frame_dir, ignore_errors=True)

        logger.info(f"Session {self.session_id}: cleaned up")

    def get_final_results(self) -> dict:
        """Return final results after stream ends."""
        elapsed = time.time() - self.start_time
        attentiveness = None
        if elapsed >= ATTENTIVENESS_MIN_ELAPSED_S and self.snapshots:
            attentiveness = compute_attentiveness(self.snapshots, {})

        return {
            "session_id": self.session_id,
            "status": "complete" if self.snapshots else "no_data",
            "frames_sent": self.frame_index,
            "snapshot_count": len(self.snapshots),
            "elapsed_s": round(elapsed, 1),
            "vitals": self.latest_vitals,
            "attentiveness": attentiveness,
        }

    def _read_stdout(self):
        """Read JSON lines from SmartSpectra stdout."""
        try:
            for line in self.process.stdout:
                line = line.strip()
                if not line:
                    continue

                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug(f"Session {self.session_id}: non-JSON stdout: {line[:200]}")
                    continue

                msg_type = data.get("type", "")

                if msg_type == "vitals":
                    self._handle_vitals(data)
                elif msg_type == "end":
                    logger.info(f"Session {self.session_id}: stream ended, {data.get('snapshot_count', 0)} snapshots")
                    break

        except Exception as e:
            logger.error(f"Session {self.session_id}: stdout reader error: {e}")
            if self._on_error:
                self._on_error(str(e))

    def _read_stderr(self):
        """Read stderr logs from SmartSpectra."""
        try:
            for line in self.process.stderr:
                line = line.strip()
                if line:
                    logger.debug(f"[SmartSpectra] {line}")
        except Exception:
            pass

    def _handle_vitals(self, data: dict):
        """Process a vitals update from the SDK."""
        snapshot = data.get("data", {})
        self.snapshots.append(snapshot)

        # Extract clean vitals
        vitals = self._extract_vitals(snapshot)
        self.latest_vitals = vitals

        # Emit vitals update
        if self._on_vitals:
            self._on_vitals({
                "vitals": vitals,
                "timestamp_ms": data.get("timestamp_ms"),
                "snapshot_index": data.get("snapshot_index"),
            })

        # Check if we should compute attentiveness
        elapsed = time.time() - self.start_time
        time_since_last = time.time() - self.last_attentiveness_time

        if elapsed >= ATTENTIVENESS_MIN_ELAPSED_S and time_since_last >= ATTENTIVENESS_UPDATE_INTERVAL_S:
            self._compute_and_emit_attentiveness(elapsed)

    def _compute_and_emit_attentiveness(self, elapsed: float):
        """Compute attentiveness from accumulated snapshots and emit."""
        try:
            attentiveness = compute_attentiveness(self.snapshots, {})
            self.latest_attentiveness = attentiveness
            self.last_attentiveness_time = time.time()

            if self._on_attentiveness:
                self._on_attentiveness({
                    "attentiveness": attentiveness,
                    "elapsed_s": round(elapsed, 1),
                    "snapshots_used": len(self.snapshots),
                })
        except Exception as e:
            logger.error(f"Session {self.session_id}: attentiveness error: {e}")

    def _extract_vitals(self, snapshot: dict) -> dict:
        """Extract clean vitals from a single SDK metrics snapshot."""
        vitals = {}

        pulse = snapshot.get("pulse", {})
        rate_list = pulse.get("rate", [])
        if rate_list:
            vitals["pulse_rate_bpm"] = rate_list[-1].get("value")

        breathing = snapshot.get("breathing", {})
        br_list = breathing.get("rate", [])
        if br_list:
            vitals["breathing_rate_bpm"] = br_list[-1].get("value")

        # HRV
        for hrv_key in ("hrv", "heartRateVariability", "pulseRateVariability"):
            hrv_data = pulse.get(hrv_key, {})
            if isinstance(hrv_data, list) and hrv_data:
                vitals["hrv_ms"] = hrv_data[-1].get("value")
                break
            elif isinstance(hrv_data, dict):
                for sub_key in ("sdnn", "rmssd", "value"):
                    sub = hrv_data.get(sub_key, [])
                    if isinstance(sub, list) and sub:
                        vitals["hrv_ms"] = sub[-1].get("value")
                        break
                if "hrv_ms" in vitals:
                    break

        # Stress
        for stress_key in ("stress", "stressIndex", "ansIndex"):
            stress = snapshot.get(stress_key)
            if stress is None:
                continue
            if isinstance(stress, dict):
                for sub_key in ("value", "index"):
                    sv = stress.get(sub_key, [])
                    if isinstance(sv, list) and sv:
                        vitals["stress_index"] = sv[-1].get("value")
                        break
            if "stress_index" in vitals:
                break

        return vitals
