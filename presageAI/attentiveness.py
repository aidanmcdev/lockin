"""
Attentiveness Score Calculator

Computes a 0-100 attentiveness score from SmartSpectra SDK physiological data.
Uses heart rate stability, HR level, breathing regularity, blink rate,
talking detection, and face stability as sub-scores.
"""

import math
from typing import Optional


# Sub-score weights
WEIGHTS = {
    "hr_stability": 0.25,
    "hr_level": 0.15,
    "breathing_regularity": 0.20,
    "blink_rate": 0.15,
    "talking": 0.10,
    "face_stability": 0.15,
}

# Attentiveness labels
LABELS = [
    (80, "highly_attentive"),
    (60, "attentive"),
    (40, "moderate"),
    (20, "distracted"),
    (0, "very_distracted"),
]


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def _linear_score(value: float, good_threshold: float, bad_threshold: float) -> float:
    """Linear interpolation: value <= good_threshold -> 100, value >= bad_threshold -> 0."""
    if good_threshold == bad_threshold:
        return 100.0 if value <= good_threshold else 0.0
    score = 100.0 * (bad_threshold - value) / (bad_threshold - good_threshold)
    return _clamp(score)


def _coefficient_of_variation(values: list) -> Optional[float]:
    """Compute CV (std/mean). Returns None if insufficient data."""
    if len(values) < 3:
        return None
    mean = sum(values) / len(values)
    if mean == 0:
        return None
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = math.sqrt(variance)
    return std / abs(mean)


def _get_label(score: int) -> str:
    for threshold, label in LABELS:
        if score >= threshold:
            return label
    return "very_distracted"


def _scale_score(raw_score: float) -> int:
    """Apply sigmoid scaling to push scores higher — raw scores tend to underestimate attentiveness."""
    k = 0.18   # steeper curve
    x0 = 45    # shift left so 55 is already "high"
    scaled = 100.0 / (1.0 + math.exp(-k * (raw_score - x0)))
    return round(_clamp(scaled))


# ---------------------------------------------------------------------------
# Sub-score functions
# ---------------------------------------------------------------------------

def score_hr_stability(pulse_rates: list) -> dict:
    """Score based on heart rate variability (lower CV = more stable = more attentive)."""
    values = [entry.get("value") for entry in pulse_rates if entry.get("value") is not None]

    if len(values) < 3:
        return {"score": None, "detail": "Insufficient HR data"}

    cv = _coefficient_of_variation(values)
    if cv is None:
        return {"score": None, "detail": "Could not compute HR variability"}

    score = _linear_score(cv, good_threshold=0.03, bad_threshold=0.15)
    return {"score": round(score, 1), "detail": f"CV={cv:.3f}, {'stable' if score > 70 else 'variable'} heart rate"}


def score_hr_level(pulse_rates: list) -> dict:
    """Score based on mean heart rate — normal resting range is better."""
    values = [entry.get("value") for entry in pulse_rates if entry.get("value") is not None]

    if not values:
        return {"score": None, "detail": "No HR data"}

    mean_hr = sum(values) / len(values)

    # 60-100 BPM is ideal
    if 60 <= mean_hr <= 100:
        score = 100.0
    elif mean_hr < 60:
        # Linear drop from 60 down to 30
        score = _linear_score(60 - mean_hr, good_threshold=0, bad_threshold=30)
    else:
        # Linear drop from 100 up to 130
        score = _linear_score(mean_hr - 100, good_threshold=0, bad_threshold=30)

    return {"score": round(score, 1), "detail": f"Mean HR {mean_hr:.1f} BPM"}


def score_breathing_regularity(breathing_rates: list, inhale_exhale_ratios: list = None) -> dict:
    """Score based on breathing rate consistency."""
    values = [entry.get("value") for entry in breathing_rates if entry.get("value") is not None]

    if len(values) < 3:
        return {"score": None, "detail": "Insufficient breathing data"}

    cv = _coefficient_of_variation(values)
    if cv is None:
        return {"score": None, "detail": "Could not compute breathing variability"}

    score = _linear_score(cv, good_threshold=0.05, bad_threshold=0.20)

    # Bonus/penalty from inhale-exhale ratio consistency
    if inhale_exhale_ratios:
        ie_values = [e.get("value") for e in inhale_exhale_ratios if e.get("value") is not None]
        if len(ie_values) >= 3:
            ie_cv = _coefficient_of_variation(ie_values)
            if ie_cv is not None:
                ie_score = _linear_score(ie_cv, good_threshold=0.05, bad_threshold=0.25)
                # Blend 80% breathing rate CV + 20% inhale/exhale consistency
                score = score * 0.8 + ie_score * 0.2

    return {"score": round(score, 1), "detail": f"CV={cv:.3f}, {'regular' if score > 70 else 'irregular'} breathing"}


def score_blink_rate(blink_entries: list) -> dict:
    """Score based on blink rate. Normal 15-20/min = attentive."""
    if len(blink_entries) < 10:
        return {"score": None, "detail": "Insufficient blink data"}

    # Count blink events (transitions to detected=True)
    blinks = 0
    prev_detected = False
    for entry in blink_entries:
        detected = entry.get("detected", False)
        if detected and not prev_detected:
            blinks += 1
        prev_detected = detected

    # Compute time span
    times = [entry.get("time", 0) for entry in blink_entries if "time" in entry]
    if len(times) < 2:
        return {"score": None, "detail": "No timing data for blinks"}

    duration_min = (times[-1] - times[0]) / 60.0
    if duration_min <= 0:
        return {"score": None, "detail": "Zero duration for blink calculation"}

    blinks_per_min = blinks / duration_min

    # Optimal: 15-20 blinks/min
    if 15 <= blinks_per_min <= 20:
        score = 100.0
    elif blinks_per_min < 15:
        # Too few: could be zoning out or staring
        score = _linear_score(15 - blinks_per_min, good_threshold=0, bad_threshold=10)
    else:
        # Too many: fatigue
        score = _linear_score(blinks_per_min - 20, good_threshold=0, bad_threshold=10)

    return {"score": round(score, 1), "detail": f"{blinks_per_min:.1f} blinks/min"}


def score_talking(talking_entries: list) -> dict:
    """Score based on talking percentage. Silent focus or moderate talking = attentive."""
    if len(talking_entries) < 10:
        return {"score": None, "detail": "Insufficient talking data"}

    talking_count = sum(1 for e in talking_entries if e.get("detected", False))
    talk_pct = talking_count / len(talking_entries) * 100

    # Scoring: 0-10% = focused silence (90), 10-30% = engaged (100),
    # 30-60% = possibly distracted (70), >60% = likely chatting (50)
    if talk_pct <= 10:
        score = 90.0
    elif talk_pct <= 30:
        score = 100.0
    elif talk_pct <= 60:
        score = _linear_score(talk_pct - 30, good_threshold=0, bad_threshold=30) * 0.3 + 70
    else:
        score = 50.0

    return {"score": round(score, 1), "detail": f"Talking {talk_pct:.0f}% of time"}


def score_face_stability(face_entries: list) -> dict:
    """Score based on how consistently the face is detected and stable."""
    if not face_entries:
        return {"score": None, "detail": "No face data"}

    stable_count = sum(1 for e in face_entries if e.get("stable", False))
    stability_pct = stable_count / len(face_entries) * 100
    score = _clamp(stability_pct)

    return {"score": round(score, 1), "detail": f"Stable in {stability_pct:.0f}% of frames"}


# ---------------------------------------------------------------------------
# Main scorer
# ---------------------------------------------------------------------------

def _merge_snapshots(all_snapshots: list) -> dict:
    """Merge all snapshot arrays into combined time-series for scoring."""
    merged = {
        "pulse_rates": [],
        "breathing_rates": [],
        "inhale_exhale_ratios": [],
        "blink_entries": [],
        "talking_entries": [],
    }

    seen_timestamps = set()

    for snap in all_snapshots:
        # Pulse rates
        for entry in snap.get("pulse", {}).get("rate", []):
            ts = entry.get("timestamp", entry.get("time"))
            if ts not in seen_timestamps:
                merged["pulse_rates"].append(entry)
                seen_timestamps.add(ts)

        # Breathing rates
        for entry in snap.get("breathing", {}).get("rate", []):
            ts = entry.get("timestamp", entry.get("time"))
            key = f"br_{ts}"
            if key not in seen_timestamps:
                merged["breathing_rates"].append(entry)
                seen_timestamps.add(key)

        # Inhale/exhale ratios
        for entry in snap.get("breathing", {}).get("inhaleExhaleRatio", []):
            ts = entry.get("timestamp", entry.get("time"))
            key = f"ie_{ts}"
            if key not in seen_timestamps:
                merged["inhale_exhale_ratios"].append(entry)
                seen_timestamps.add(key)

        # Blink entries
        for entry in snap.get("face", {}).get("blinking", []):
            ts = entry.get("timestamp", entry.get("time"))
            key = f"blink_{ts}"
            if key not in seen_timestamps:
                merged["blink_entries"].append(entry)
                seen_timestamps.add(key)

        # Talking entries
        for entry in snap.get("face", {}).get("talking", []):
            ts = entry.get("timestamp", entry.get("time"))
            key = f"talk_{ts}"
            if key not in seen_timestamps:
                merged["talking_entries"].append(entry)
                seen_timestamps.add(key)

    return merged


def compute_attentiveness(all_snapshots: list, metadata: dict = None) -> dict:
    """
    Compute attentiveness score from SmartSpectra SDK snapshots.

    Args:
        all_snapshots: List of MetricsBuffer JSON dicts from the SDK
        metadata: Optional metadata dict

    Returns:
        Dict with score (0-100), label, sub_scores, and data_quality
    """
    if not all_snapshots:
        return {
            "score": None,
            "label": "unknown",
            "sub_scores": {},
            "data_quality": "insufficient",
            "factors_available": 0,
        }

    # Merge all snapshots into combined time-series
    merged = _merge_snapshots(all_snapshots)

    # Compute all sub-scores
    raw_scores = {
        "hr_stability": score_hr_stability(merged["pulse_rates"]),
        "hr_level": score_hr_level(merged["pulse_rates"]),
        "breathing_regularity": score_breathing_regularity(
            merged["breathing_rates"], merged["inhale_exhale_ratios"]
        ),
        "blink_rate": score_blink_rate(merged["blink_entries"]),
        "talking": score_talking(merged["talking_entries"]),
        "face_stability": score_face_stability(merged["blink_entries"]),  # use blink entries as proxy for face presence
    }

    # Separate available vs unavailable scores
    available = {}
    unavailable = []
    for key, result in raw_scores.items():
        if result["score"] is not None:
            available[key] = result
        else:
            unavailable.append(key)

    factors_available = len(available)

    if factors_available < 2:
        return {
            "score": None,
            "label": "unknown",
            "sub_scores": {k: {**v, "weight": WEIGHTS[k]} for k, v in raw_scores.items()},
            "data_quality": "insufficient",
            "factors_available": factors_available,
        }

    # Redistribute weights from unavailable scores
    total_available_weight = sum(WEIGHTS[k] for k in available)
    weight_multiplier = 1.0 / total_available_weight if total_available_weight > 0 else 1.0

    # Compute weighted score
    weighted_sum = 0.0
    sub_scores = {}
    for key, result in raw_scores.items():
        effective_weight = WEIGHTS[key] * weight_multiplier if key in available else 0.0
        sub_scores[key] = {
            "score": result["score"],
            "weight": round(effective_weight, 3),
            "detail": result["detail"],
        }
        if result["score"] is not None:
            weighted_sum += result["score"] * effective_weight

    raw_score = round(_clamp(weighted_sum))
    final_score = _scale_score(raw_score)

    # Determine data quality
    if factors_available >= 5:
        data_quality = "good"
    elif factors_available >= 3:
        data_quality = "partial"
    else:
        data_quality = "limited"

    return {
        "score": final_score,
        "label": _get_label(final_score),
        "sub_scores": sub_scores,
        "data_quality": data_quality,
        "factors_available": factors_available,
    }
