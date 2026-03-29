const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const debugSpeakBtn = document.getElementById("debugSpeakBtn");

let lookAwayStart = null;
let lastSpoken = 0;
let hasWarnedThisEpisode = false;

const DISTRACTION_SECONDS = 0.3;
const SPEECH_COOLDOWN_SECONDS = 5.0;

// Loosened thresholds — tighten gradually once baseline works
const EYE_BALANCE_THRESHOLD = 0.25;
const NOSE_FACE_RATIO_THRESHOLD = 0.25;
const EYE_TILT_THRESHOLD = 0.20;
const MIN_FACE_WIDTH_RATIO = 0.10;

const focusMessages = [
  "Hey, I noticed you drifted. That's okay — it happens. Come on back when you're ready.",
  "You were doing really well. Let's get back to it together.",
  "It's easy to lose focus. Take a breath, and let's pick up where you left off.",
  "I know this might be hard right now, but you're closer than you think. Keep going.",
  "Just a gentle reminder — your work matters. Let's give it your attention.",
  "You don't have to be perfect. Just present. Come back to the task.",
  "It's okay to struggle. What matters is coming back. You've got this.",
  "I believe you can finish this. Let's take it one small step at a time.",
  "Hey — no judgment. Let's just refocus and keep moving forward.",
  "You started this for a reason. That reason hasn't changed. Come back to it."
];

function nowSeconds() {
  return performance.now() / 1000;
}

function getRandomMessage() {
  return focusMessages[Math.floor(Math.random() * focusMessages.length)];
}

async function speakFocusMessage(text, force = false) {
  const now = nowSeconds();

  if (!force && now - lastSpoken < SPEECH_COOLDOWN_SECONDS) {
    return;
  }

  lastSpoken = now;

  try {
    const response = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      console.error("TTS failed");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch (err) {
    console.error("speakFocusMessage error:", err);
  }
}

debugSpeakBtn?.addEventListener("click", async () => {
  try {
    await speakFocusMessage(getRandomMessage(), true);
  } catch (err) {
    console.error("Debug speak failed:", err);
  }
});

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });

  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      resolve();
    };
  });
}

function drawStatus(text) {
  statusEl.textContent = text;
}

function drawPoint(x, y, color = "yellow") {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function getBox(detection) {
  if (!detection?.boundingBox) return null;
  return {
    x: detection.boundingBox.originX,
    y: detection.boundingBox.originY,
    width: detection.boundingBox.width,
    height: detection.boundingBox.height,
  };
}

function drawFaceBox(box) {
  ctx.strokeStyle = "lime";
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  drawPoint(box.x + box.width / 2, box.y + box.height / 2, "blue");
}

// BlazeFace keypoint indices:
// 0 = right eye, 1 = left eye, 2 = nose tip, 3 = mouth, 4 = right ear, 5 = left ear
function getKeypointByIndex(detection, index) {
  return detection.keypoints?.[index] || null;
}

// Convert MediaPipe normalized keypoint (0–1) to pixel coordinates
function toPixel(kp, canvasW, canvasH) {
  return { x: kp.x * canvasW, y: kp.y * canvasH };
}

function analyzeDetection(detection) {
  const box = getBox(detection);

  if (!box) {
    return {
      distracted: true,
      reason: "No Face",
      eyeBalance: 1,
      noseFaceRatioX: 1,
      eyeTilt: 1,
      faceWidthRatio: 0,
    };
  }

  const leftEyeRaw  = getKeypointByIndex(detection, 1); // left eye
  const rightEyeRaw = getKeypointByIndex(detection, 0); // right eye
  const noseTipRaw  = getKeypointByIndex(detection, 2); // nose tip

  if (!leftEyeRaw || !rightEyeRaw || !noseTipRaw) {
    return {
      distracted: true,
      reason: "Missing Keypoints",
      eyeBalance: 1,
      noseFaceRatioX: 1,
      eyeTilt: 1,
      faceWidthRatio: box.width / canvas.width,
    };
  }

  // Convert normalized keypoints to pixel space so they match the bounding box
  const leftEye  = toPixel(leftEyeRaw,  canvas.width, canvas.height);
  const rightEye = toPixel(rightEyeRaw, canvas.width, canvas.height);
  const noseTip  = toPixel(noseTipRaw,  canvas.width, canvas.height);

  drawPoint(leftEye.x,  leftEye.y,  "cyan");
  drawPoint(rightEye.x, rightEye.y, "cyan");
  drawPoint(noseTip.x,  noseTip.y,  "yellow");

  const faceCenterX = box.x + box.width / 2;
  const eyeMidX     = (leftEye.x + rightEye.x) / 2;

  // How far the nose is from the midpoint between the eyes (relative to face width)
  const eyeBalance = Math.abs(noseTip.x - eyeMidX) / box.width;

  // How far the nose is from the face box center (relative to face width)
  const noseFaceRatioX = Math.abs(noseTip.x - faceCenterX) / box.width;

  // How much the eyes are vertically offset from each other (relative to face height)
  const eyeTilt = Math.abs(leftEye.y - rightEye.y) / box.height;

  // How large the face is relative to the canvas — too small = unreliable
  const faceWidthRatio = box.width / canvas.width;

  const distracted =
    faceWidthRatio < MIN_FACE_WIDTH_RATIO ||
    eyeBalance     > EYE_BALANCE_THRESHOLD ||
    noseFaceRatioX > NOSE_FACE_RATIO_THRESHOLD ||
    eyeTilt        > EYE_TILT_THRESHOLD;

  return {
    distracted,
    reason: distracted ? "Not Focused" : "Focused",
    eyeBalance,
    noseFaceRatioX,
    eyeTilt,
    faceWidthRatio,
  };
}

async function handleFocusState(distracted) {
  const now = nowSeconds();

  // Update the cloud widget reactively
  if (window.setFocusState) window.setFocusState(!distracted);

  if (distracted) {
    if (lookAwayStart === null) {
      lookAwayStart = now;
      hasWarnedThisEpisode = false;
    } else if (now - lookAwayStart >= DISTRACTION_SECONDS && !hasWarnedThisEpisode) {
      hasWarnedThisEpisode = true;
      await speakFocusMessage(getRandomMessage());
    }
  } else {
    lookAwayStart = null;
    hasWarnedThisEpisode = false;
  }
}

async function start() {
  await setupCamera();

  const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest");
  const { FaceDetector, FilesetResolver } = visionModule;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  const faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.6,
  });

  async function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const timestampMs = performance.now();
    const result = faceDetector.detectForVideo(video, timestampMs);

    let distracted = false;
    let statusText = "Focused";
    let statusColor = "lime";

    if (result.detections && result.detections.length > 0) {
      // Use the largest detected face
      const detection = result.detections.reduce((largest, current) => {
        const a = getBox(largest);
        const b = getBox(current);
        const areaA = a ? a.width * a.height : 0;
        const areaB = b ? b.width * b.height : 0;
        return areaB > areaA ? current : largest;
      });

      const box = getBox(detection);
      if (box) drawFaceBox(box);

      const analysis = analyzeDetection(detection);
      distracted   = analysis.distracted;
      statusText   = analysis.reason;
      statusColor  = distracted ? "red" : "lime";

    } else {
      distracted  = true;
      statusText  = "No Face Detected";
      statusColor = "red";
    }

    await handleFocusState(distracted);
    drawStatus(statusText);

    requestAnimationFrame(loop);
  }

  loop();
}

start().catch((err) => {
  console.error(err);
  statusEl.textContent = "Failed to start";
});