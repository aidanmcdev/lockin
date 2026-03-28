"""
Phone usage detector using MediaPipe Pose.

Detects two phone-use postures:
  1. Calling: wrist near ear
  2. Texting/scrolling: wrist in front of body + head tilted down

Only flags phone usage when detected continuously for >5 seconds.
Brief interruptions (<1s) are smoothed over.
"""

import cv2
import numpy as np
import mediapipe as mp

mp_pose = mp.solutions.pose


def _distance(p1, p2):
    """Euclidean distance between two (x, y) points."""
    return np.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


def _landmark_xy(landmark, w, h):
    """Convert a normalized MediaPipe landmark to pixel coords."""
    return (landmark.x * w, landmark.y * h)


class PhoneDetector:
    """Detects phone usage from video frames using pose estimation."""

    def __init__(self, fps: float = 10.0, threshold_seconds: float = 5.0):
        self.fps = fps
        self.threshold_seconds = threshold_seconds
        self.smoothing_seconds = 1.0  # ignore gaps shorter than this

        self.pose = mp_pose.Pose(
            model_complexity=1,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        # Per-frame detection history: list of (timestamp, detected, posture_type)
        self._history = []

    def detect(self, frame: np.ndarray, timestamp: float) -> dict:
        """Analyze a single frame for phone usage.

        Args:
            frame: BGR numpy array
            timestamp: seconds since start of capture

        Returns:
            {"phone_detected": bool, "posture": "calling"|"texting"|None}
        """
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.pose.process(rgb)

        if not results.pose_landmarks:
            self._history.append((timestamp, False, None))
            return {"phone_detected": False, "posture": None}

        lm = results.pose_landmarks.landmark

        # Key landmarks
        left_wrist = _landmark_xy(lm[mp_pose.PoseLandmark.LEFT_WRIST], w, h)
        right_wrist = _landmark_xy(lm[mp_pose.PoseLandmark.RIGHT_WRIST], w, h)
        left_ear = _landmark_xy(lm[mp_pose.PoseLandmark.LEFT_EAR], w, h)
        right_ear = _landmark_xy(lm[mp_pose.PoseLandmark.RIGHT_EAR], w, h)
        left_shoulder = _landmark_xy(lm[mp_pose.PoseLandmark.LEFT_SHOULDER], w, h)
        right_shoulder = _landmark_xy(lm[mp_pose.PoseLandmark.RIGHT_SHOULDER], w, h)
        left_hip = _landmark_xy(lm[mp_pose.PoseLandmark.LEFT_HIP], w, h)
        right_hip = _landmark_xy(lm[mp_pose.PoseLandmark.RIGHT_HIP], w, h)
        nose = _landmark_xy(lm[mp_pose.PoseLandmark.NOSE], w, h)
        left_eye = _landmark_xy(lm[mp_pose.PoseLandmark.LEFT_EYE], w, h)
        right_eye = _landmark_xy(lm[mp_pose.PoseLandmark.RIGHT_EYE], w, h)

        shoulder_width = _distance(left_shoulder, right_shoulder)
        if shoulder_width < 1:
            self._history.append((timestamp, False, None))
            return {"phone_detected": False, "posture": None}

        # --- Pattern 1: Calling (wrist near ear) ---
        calling = False
        left_wrist_to_left_ear = _distance(left_wrist, left_ear)
        right_wrist_to_right_ear = _distance(right_wrist, right_ear)
        # Also check cross-hand (left wrist to right ear, etc.)
        left_wrist_to_right_ear = _distance(left_wrist, right_ear)
        right_wrist_to_left_ear = _distance(right_wrist, left_ear)

        ear_threshold = shoulder_width * 0.4
        if (left_wrist_to_left_ear < ear_threshold or
                left_wrist_to_right_ear < ear_threshold or
                right_wrist_to_right_ear < ear_threshold or
                right_wrist_to_left_ear < ear_threshold):
            calling = True

        # --- Pattern 2: Texting (wrist in front + head down) ---
        texting = False

        # Vertical bounds: between shoulder and hip level
        shoulder_y = (left_shoulder[1] + right_shoulder[1]) / 2
        hip_y = (left_hip[1] + right_hip[1]) / 2
        # Horizontal bounds: between shoulders (with some margin)
        shoulder_left_x = min(left_shoulder[0], right_shoulder[0]) - shoulder_width * 0.2
        shoulder_right_x = max(left_shoulder[0], right_shoulder[0]) + shoulder_width * 0.2

        def wrist_in_front(wrist):
            """Check if wrist is in the front-of-body zone."""
            in_vertical = shoulder_y - shoulder_width * 0.3 < wrist[1] < hip_y + shoulder_width * 0.3
            in_horizontal = shoulder_left_x < wrist[0] < shoulder_right_x
            return in_vertical and in_horizontal

        # Head tilt: nose below eye midpoint by a threshold
        eye_mid_y = (left_eye[1] + right_eye[1]) / 2
        head_down = (nose[1] - eye_mid_y) > shoulder_width * 0.08

        left_in_front = wrist_in_front(left_wrist)
        right_in_front = wrist_in_front(right_wrist)

        if (left_in_front or right_in_front) and head_down:
            texting = True

        # Determine result
        if calling:
            self._history.append((timestamp, True, "calling"))
            return {"phone_detected": True, "posture": "calling"}
        elif texting:
            self._history.append((timestamp, True, "texting"))
            return {"phone_detected": True, "posture": "texting"}
        else:
            self._history.append((timestamp, False, None))
            return {"phone_detected": False, "posture": None}

    def get_summary(self) -> dict:
        """Return aggregated phone detection results with 5s threshold and smoothing.

        Returns:
            {
                "on_phone": bool,         # True if any event >= threshold
                "total_phone_seconds": float,
                "events": [{"start": float, "end": float, "type": str}, ...]
            }
        """
        if not self._history:
            return {"on_phone": False, "total_phone_seconds": 0.0, "events": []}

        # Step 1: Build raw events from consecutive detections
        raw_events = []
        current_event = None

        for ts, detected, posture in self._history:
            if detected:
                if current_event is None:
                    current_event = {"start": ts, "end": ts, "type": posture}
                else:
                    # If gap since last detection is small, extend (smoothing)
                    gap = ts - current_event["end"]
                    if gap <= self.smoothing_seconds:
                        current_event["end"] = ts
                        # Keep the dominant posture type
                        if posture and posture != current_event["type"]:
                            # Count which type appears more
                            current_event["type"] = posture
                    else:
                        raw_events.append(current_event)
                        current_event = {"start": ts, "end": ts, "type": posture}
            else:
                if current_event is not None:
                    gap = ts - current_event["end"]
                    if gap > self.smoothing_seconds:
                        raw_events.append(current_event)
                        current_event = None

        if current_event is not None:
            raw_events.append(current_event)

        # Step 2: Filter to events >= threshold
        events = []
        total_seconds = 0.0
        for ev in raw_events:
            duration = ev["end"] - ev["start"]
            if duration >= self.threshold_seconds:
                ev_out = {
                    "start": round(ev["start"], 1),
                    "end": round(ev["end"], 1),
                    "duration": round(duration, 1),
                    "type": ev["type"] or "unknown",
                }
                events.append(ev_out)
                total_seconds += duration

        return {
            "on_phone": len(events) > 0,
            "total_phone_seconds": round(total_seconds, 1),
            "events": events,
        }

    def reset(self):
        """Reset detection state."""
        self._history = []
