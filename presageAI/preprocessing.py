"""
Frame-level preprocessing for Presage Physiology API.

Extracts face mesh BGR traces and respiratory tracking points from frames,
then packages them into the trace format expected by the Presage API.
"""

import json
import gzip
import cv2
import numpy as np
import mediapipe as mp

mp_face_mesh = mp.solutions.face_mesh
mp_pose = mp.solutions.pose


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


# Face mesh ROI indices for extracting BGR averages
FACE_ROIS = {
    "left_fh_t": [54, 68, 104, 69, 67, 103],
    "left_fh_b": [68, 63, 105, 66, 69, 104],
    "center_fh_lt": [67, 69, 108, 151, 10, 109],
    "center_fh_lb": [69, 66, 107, 9, 151, 108],
    "center_fh_rt": [10, 151, 337, 299, 297, 338],
    "center_fh_rb": [151, 9, 336, 296, 299, 337],
    "right_fh_t": [297, 299, 333, 298, 284, 332],
    "right_fh_b": [299, 296, 334, 293, 298, 333],
    "center_fh_b": [107, 55, 193, 168, 417, 285, 336, 9],
    "nose_top": [193, 122, 196, 197, 419, 351, 417, 168],
    "nose_bot": [196, 3, 51, 45, 275, 281, 248, 419, 197],
    "lc_t": [31, 117, 50, 101, 100, 47, 114, 121, 230, 229],
    "lc_b": [50, 187, 207, 206, 203, 129, 142, 101],
    "rc_t": [261, 346, 280, 330, 329, 277, 343, 350, 450, 449, 448],
    "rc_b": [280, 411, 427, 426, 423, 358, 371, 330],
}


def get_face_mesh_landmarks(frame, face_mesh):
    """Extract face mesh landmarks from a BGR frame."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)
    if not results.multi_face_landmarks:
        return None
    landmarks = results.multi_face_landmarks[0]
    h, w = frame.shape[:2]
    pts = np.array([[int(lm.x * w), int(lm.y * h)] for lm in landmarks.landmark])
    return pts.reshape(-1, 1, 2).astype(np.float32)


def average_rois(frame, points):
    """Compute average BGR values for face ROIs."""
    all_rois = list(FACE_ROIS.values())
    grid_bgr = np.zeros((len(all_rois), 3))
    points = np.array(np.squeeze(points), dtype="int32")
    h, w, _ = frame.shape
    dummy = np.zeros((h, w), dtype=np.int32)

    for i, roi in enumerate(all_rois):
        outline = np.squeeze(cv2.convexHull(points[roi, :]))
        mask = cv2.fillPoly(dummy.copy(), [outline], 1)
        grid_bgr[i, :] = np.array(cv2.mean(frame, mask.astype(np.uint8)))[:-1]

    outline = np.squeeze(cv2.convexHull(points))
    mask = cv2.fillPoly(dummy.copy(), [outline], 1)
    whole_face = np.array(cv2.mean(frame, mask.astype(np.uint8)))[:-1]
    return np.around(whole_face, decimals=8), np.around(grid_bgr, decimals=8)


def get_x_int(pt1, pt2):
    m = (pt2[1] - pt1[1]) / (pt2[0] - pt1[0])
    return pt2[0] - pt2[1] / m


def get_rr_tracking_pts(frame, face_location):
    """Get respiratory tracking points from upper body region."""
    corners = []
    corner_labels = []
    try:
        with mp_pose.Pose(
            model_complexity=1,
            enable_segmentation=True,
            min_detection_confidence=0.5,
        ) as pose:
            sz = frame.shape[:2]
            results = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if not results.pose_landmarks:
                return np.array([]), np.array([])

            lshoulder = results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_SHOULDER]
            rshoulder = results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_SHOULDER]
            lhip = results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_HIP]
            rhip = results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_HIP]

            rshoulder = [int(rshoulder.x * sz[1]), int(rshoulder.y * sz[0])]
            lshoulder = [int(lshoulder.x * sz[1]), int(lshoulder.y * sz[0])]
            rhip = [int(rhip.x * sz[1]), int(rhip.y * sz[0])]
            lhip = [int(lhip.x * sz[1]), int(lhip.y * sz[0])]

            lxint = get_x_int(lhip, lshoulder)
            rxint = get_x_int(rhip, rshoulder)

            polygon = np.array([
                [lhip[0], lhip[1]], [lshoulder[0], lshoulder[1]],
                [lxint, 0], [rxint, 0],
                [rshoulder[0], rshoulder[1]], [rhip[0], rhip[1]],
            ], dtype="int32")

            polygon_chest = np.array([
                [lhip[0], lhip[1]], [lshoulder[0], lshoulder[1]],
                [rshoulder[0], rshoulder[1]], [rhip[0], rhip[1]],
            ], dtype="int32")

            if face_location is not None and len(face_location) > 4:
                polygon_face = np.array(face_location, dtype="int32")
            elif face_location is not None and len(face_location) > 0:
                polygon_face = np.array([
                    [face_location[0], face_location[3]],
                    [face_location[2], face_location[3]],
                    [face_location[2], face_location[1]],
                    [face_location[0], face_location[1]],
                ], dtype="int32")
            else:
                polygon_face = []
                for i in range(11):
                    polygon_face.append([
                        int(results.pose_landmarks.landmark[i].x * sz[1]),
                        int(results.pose_landmarks.landmark[i].y * sz[0]),
                    ])
                polygon_face = np.array(polygon_face, dtype="int32")

            upper_mask = np.zeros(frame.shape[:2])
            if len(polygon) > 0:
                hull = cv2.convexHull(polygon)
                upper_mask = cv2.fillConvexPoly(upper_mask, hull, 1)
            upper_mask = upper_mask > 0.5

            chest_mask = np.zeros(frame.shape[:2])
            if len(polygon_chest) > 0:
                hull = cv2.convexHull(polygon_chest)
                chest_mask = cv2.fillConvexPoly(chest_mask, hull, 1)
            chest_mask = chest_mask > 0.5

            face_mask = np.zeros(frame.shape[:2])
            if len(polygon_face) > 0:
                hull = cv2.convexHull(polygon_face)
                face_mask = cv2.fillConvexPoly(face_mask, hull, 1)
            face_mask = face_mask > 0.5

            pose_mask = results.segmentation_mask > 0.5

            min_distance = round(np.sum((upper_mask & pose_mask).astype("uint8")) ** 0.5 / 15)
            if min_distance < 1:
                min_distance = 1
            feature_params = dict(maxCorners=225, qualityLevel=0.0005, minDistance=min_distance)
            corners = cv2.goodFeaturesToTrack(
                cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY),
                mask=(upper_mask & pose_mask & ~face_mask).astype("uint8"),
                **feature_params,
            )
            if corners is None:
                return np.array([]), np.array([])

            contours_chest, _ = cv2.findContours(chest_mask.astype("uint8"), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            contours_face, _ = cv2.findContours(face_mask.astype("uint8"), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            corner_labels = np.zeros(corners.shape[0])
            for ipt in range(corners.shape[0]):
                closest_chest = cv2.pointPolygonTest(contours_chest[0], (corners[ipt, 0, 0], corners[ipt, 0, 1]), True)
                closest_face = cv2.pointPolygonTest(contours_face[0], (corners[ipt, 0, 0], corners[ipt, 0, 1]), True)
                if closest_face > closest_chest:
                    corner_labels[ipt] = 1
    except Exception as e:
        pass
    return corners if len(corners) > 0 else np.array([]), corner_labels


def track_points_rr(frame, frame_prev, points_prev):
    """Track respiratory points between frames using optical flow."""
    try:
        lk_params = dict(
            winSize=(15, 15),
            maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
        )
        corners_1, found1, _ = cv2.calcOpticalFlowPyrLK(frame_prev, frame, points_prev, None, **lk_params)
        corners_0, found2, _ = cv2.calcOpticalFlowPyrLK(frame, frame_prev, corners_1, None, **lk_params)

        corners_1v = []
        for cc in range(points_prev.shape[0]):
            if (found1[cc] and found2[cc]) and np.sqrt(np.sum((points_prev[cc] - corners_0[cc]) ** 2)) < 2:
                corners_1v.append(corners_1[cc])
            else:
                corners_1v.append(np.array([[np.nan, np.nan]]))
        return np.float32(corners_1v)
    except Exception:
        return np.array([])


class FrameProcessor:
    """Processes individual frames and accumulates trace data for the Presage API."""

    def __init__(self, fps: float = 10.0):
        self.fps = fps
        self.face_mesh = mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.frames_trace = []
        self.frame_count = 0
        self.last_rr_frame = None
        self.last_rr_index = None
        self.last_hr_pts = None
        self.mod_hr = 1  # process every frame in real-time mode
        self.mod_rr = max(1, round(fps / 5))  # RR optimal at ~5fps

    def process_frame(self, frame: np.ndarray) -> dict:
        """Process a single BGR frame. Returns extracted data for this frame."""
        frame_data = {}
        fake_time = self.frame_count / self.fps

        do_hr = (self.frame_count % self.mod_hr == 0)
        do_rr = (self.frame_count % self.mod_rr == 0)

        if do_hr:
            hr_pts = get_face_mesh_landmarks(frame, self.face_mesh)
            if hr_pts is not None:
                whole_face, grid_bgr = average_rois(frame, hr_pts)
                frame_data["bgr"] = (whole_face, grid_bgr)
                frame_data["hr_pts"] = hr_pts
                self.last_hr_pts = hr_pts
            else:
                frame_data["bgr"] = []
                frame_data["hr_pts"] = None

        if do_rr:
            face_loc = self.last_hr_pts
            if self.last_rr_frame is None:
                rr_data = self._process_rr_init(frame, face_loc)
            else:
                rr_data = self._process_rr_track(frame, face_loc)
            frame_data.update(rr_data)
            self.last_rr_frame = frame.copy()
            self.last_rr_index = len(self.frames_trace)

        frame_data["time_now"] = round(fake_time, 3)
        self.frames_trace.append(frame_data)
        self.frame_count += 1
        return frame_data

    def _process_rr_init(self, frame, face_location):
        rr_pts, rr_pt_labels = get_rr_tracking_pts(frame, face_location)
        return {"rr_pts": rr_pts, "rr_pt_labels": rr_pt_labels, "rr_reset": True}

    def _process_rr_track(self, frame, face_location):
        prev_data = self.frames_trace[self.last_rr_index]
        rr_pts_prev = prev_data.get("rr_pts", [])
        if len(rr_pts_prev) == 0 or np.sum([~np.isnan(x[0][0]) for x in rr_pts_prev]) < 20:
            rr_pts, rr_pt_labels = get_rr_tracking_pts(frame, face_location)
            return {"rr_pts": rr_pts, "rr_pt_labels": rr_pt_labels, "rr_reset": True}
        else:
            rr_pts = track_points_rr(frame, self.last_rr_frame, rr_pts_prev)
            return {
                "rr_pts": rr_pts,
                "rr_pt_labels": prev_data.get("rr_pt_labels", []),
                "rr_reset": False,
            }

    def get_trace(self) -> dict:
        """Return the accumulated trace in Presage API format."""
        trace = {
            "settings": {
                "FPS_NR_EFF": self.fps / self.mod_hr,
                "MOD_AMOUNT_HR": self.mod_hr,
                "MOD_AMOUNT_RR": self.mod_rr,
                "preprocessing_version": "1.2.1",
            },
            "frames": self.frames_trace,
        }
        return json.loads(json.dumps(trace, cls=NumpyEncoder))

    def get_compressed_trace(self) -> bytes:
        """Return gzipped JSON bytes ready for the Presage API."""
        trace = self.get_trace()
        return gzip.compress(json.dumps(trace).encode("utf-8"))

    def reset(self):
        """Reset state for a new recording session."""
        self.frames_trace = []
        self.frame_count = 0
        self.last_rr_frame = None
        self.last_rr_index = None
        self.last_hr_pts = None
