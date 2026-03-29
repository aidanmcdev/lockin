/**
 * MediaPipe face pose → focus signal for FocusWidget via `window.setFocusState(isFocused)`.
 * Creates a small off-screen (or corner) video/canvas; no HTML placeholders required.
 *
 * Uses `@mediapipe/tasks-vision` from npm + local `public/mediapipe-wasm` (see `scripts/copy-mediapipe-assets.mjs`)
 * so Chrome extension CSP (`script-src 'self'`) does not block CDN dynamic imports.
 */

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision"

import type { ActivityMode } from "@/components/widget/ActivityModeRow"

function getActivityMode(): ActivityMode {
  const fn = window.getActivityMode
  return typeof fn === "function" ? fn() : "lecture"
}

function isUserTtsEnabled(): boolean {
  const fn = window.getTtsEnabled
  return typeof fn !== "function" || fn()
}

/** When `true`, distraction nudges call `POST /tts` (ElevenLabs via `src/utils/server.js`). */
export const ENABLE_ELEVENLABS_TTS = true

/** Resolves TTS URL: Vite dev uses proxied `/tts`; built extension must use absolute `localhost` (see manifest `host_permissions`). */
function getTtsEndpoint(): string {
  const fromEnv = import.meta.env.VITE_TTS_URL as string | undefined
  if (fromEnv?.trim()) {
    const base = fromEnv.trim().replace(/\/$/, "")
    return base.endsWith("/tts") ? base : `${base}/tts`
  }
  if (import.meta.env.DEV) return "/tts"
  return "http://localhost:3000/tts"
}

function mediapipeWasmRoot(): string {
  const cr = (
    globalThis as { chrome?: { runtime?: { getURL: (path: string) => string } } }
  ).chrome
  if (cr?.runtime?.getURL) {
    return cr.runtime.getURL("mediapipe-wasm/")
  }
  return `${import.meta.env.BASE_URL}mediapipe-wasm/`
}

function blazeFaceModelUrl(): string {
  const cr = (
    globalThis as { chrome?: { runtime?: { getURL: (path: string) => string } } }
  ).chrome
  if (cr?.runtime?.getURL) {
    return cr.runtime.getURL("mediapipe-models/blaze_face_short_range.tflite")
  }
  return `${import.meta.env.BASE_URL}mediapipe-models/blaze_face_short_range.tflite`
}

let lastSpoken = 0

const SPEECH_COOLDOWN_SECONDS = 5.0

/** How long to wait between nudges while UI stays `distracted` (must be ≥ cooldown). */
export const STEADY_DISTRACTED_NUDGE_MS = Math.ceil(SPEECH_COOLDOWN_SECONDS * 1000) + 800

// Slightly loose so straight-on faces aren’t always “distracted” (tune per setup).
const EYE_BALANCE_THRESHOLD = 0.35
const NOSE_FACE_RATIO_THRESHOLD = 0.35
const EYE_TILT_THRESHOLD = 0.28
const MIN_FACE_WIDTH_RATIO = 0.08
/**
 * Nose below eye midline, divided by face height — above this ⇒ head pitched down (desk/phone).
 * Calibrated: full look-down read ~0.32 here; keep threshold below that so it still trips.
 */
const LOOK_DOWN_THRESHOLD = 0.28
/**
 * Baseline for `lookUpMargin = LOOK_UP_THRESHOLD - lookDownRatio`. Tune with {@link LOOK_UP_MARGIN_MIN}
 * so glance-up poses still clear the margin (field samples ~0.14–0.18 on `lookDownRatio`).
 */
const LOOK_UP_THRESHOLD = 0.5
/** **Looking up** ⇔ `lookUpMargin` is strictly greater than this. */
const LOOK_UP_MARGIN_MIN = 0.3

/** Snapshot of tuning constants for debug logs. */
const FOCUS_THRESHOLDS = {
  eyeBalance: EYE_BALANCE_THRESHOLD,
  noseFaceRatioX: NOSE_FACE_RATIO_THRESHOLD,
  eyeTilt: EYE_TILT_THRESHOLD,
  minFaceWidthRatio: MIN_FACE_WIDTH_RATIO,
  lookDown: LOOK_DOWN_THRESHOLD,
  lookUp: LOOK_UP_THRESHOLD,
  lookUpMarginMin: LOOK_UP_MARGIN_MIN,
} as const

export type FocusThresholdsSnapshot = {
  eyeBalance: number
  noseFaceRatioX: number
  eyeTilt: number
  minFaceWidthRatio: number
  lookDown: number
  lookUp: number
  lookUpMarginMin: number
}

/** Latest frame metadata for Settings / debug UI (updated each processed video frame). */
export type FocusDebugSnapshot = {
  phase: "calibrating" | "tracking"
  faceSeenOnce: boolean
  detections: number
  videoTimeMs: number
  videoCurrentTime: number
  canvas: { width: number; height: number }
  videoDisplay: { width: number; height: number }
  activityMode: ActivityMode
  thresholds: FocusThresholdsSnapshot
  status: string
  detectionScore?: number | null
  distracted?: boolean
  widgetIsFocused?: boolean
  reason?: string
  eyeBalance?: number
  noseFaceRatioX?: number
  eyeTilt?: number
  faceWidthRatio?: number
  lookDownRatio?: number
  lookingDown?: boolean
  lookingUp?: boolean
  faceTooSmall?: boolean
  poseAwayFromScreen?: boolean
  lookUpMargin?: number | null
  box?: { x: number; y: number; width: number; height: number } | null
  note?: string
}

let focusDetectionVideoEl: HTMLVideoElement | null = null
let focusDetectionCanvasEl: HTMLCanvasElement | null = null
let lastFocusDebugSnapshot: FocusDebugSnapshot | null = null

function thresholdsSnapshot(): FocusThresholdsSnapshot {
  return { ...FOCUS_THRESHOLDS }
}

/** Live camera element used by MediaPipe (same stream can be mirrored elsewhere). */
export function getFocusDetectionVideo(): HTMLVideoElement | null {
  return focusDetectionVideoEl
}

/** Canvas with drawn frame + face box — copy to UI with `drawImage` if needed. */
export function getFocusDetectionCanvas(): HTMLCanvasElement | null {
  return focusDetectionCanvasEl
}

export function getFocusDebugSnapshot(): FocusDebugSnapshot | null {
  return lastFocusDebugSnapshot
}

/** Ordered calm → unhinged; each distraction nudge advances (capped at last line). */
const focusMessages = [
  // calm / supportive
  "Hey… quick vibe check. We’re not really locked in right now.",
  "You good? Because this doesn’t look very locked in to me.",
  "Alright, tiny drift detected. Let’s lock in again real quick.",
  "Focus just left the chat… let’s bring it back and lock in.",
  // playful calling out
  "Be honest… are we working or just pretending to lock in?",
  "This is not very locked in behavior of you.",
  "You opened this for a reason. Let’s actually lock in.",
  "Lock in. Just a little bit. I believe in you. Barely.",
  // getting more direct
  "Okay yeah we’re definitely not locked in anymore.",
  "Bro. Lock in. It’s getting concerning.",
  "You said you were gonna lock in. This is not that.",
  "We are drifting HARD. Lock it in right now.",
  // aggressive but funny
  "LOCK. IN. PLEASE.",
  "nah this is crazy. lock in immediately",
  "you are doing everything except locking in right now",
  "respectfully… lock in bro",
  // max level unhinged
  "THIS IS A LOCK IN EMERGENCY",
  "what are we doing. lock in",
  "i’m not asking anymore. lock in.",
  "final warning. lock in or we’re playing this again.",
] as const

type ElevenLabsVoiceSettings = {
  stability: number
  similarity_boost: number
  style: number
  use_speaker_boost: boolean
}

/** 0 = calm … 4 = max; drives ElevenLabs `voice_settings` (lower stability + higher style = more intense). */
function voiceSettingsForTier(tier: number): ElevenLabsVoiceSettings {
  const t = Math.min(4, Math.max(0, tier))
  return {
    stability: 0.72 - t * 0.1,
    similarity_boost: 0.78 - t * 0.02,
    style: 0.12 + t * 0.14,
    use_speaker_boost: true,
  }
}

/** Next line index for lock-in nudges; persists until page reload (each distracted nudge steps up). */
let focusNudgeEscalation = 0

function nowSeconds() {
  return performance.now() / 1000
}

/** Lets `HTMLAudioElement.play()` succeed after Chrome’s autoplay policy (extension iframe). */
function installTtsAudioUnlock(win: Window) {
  const onFirstInteraction = () => {
    const a = new Audio()
    // Tiny valid WAV so `play()` resolves and unlocks audio for this document.
    a.src =
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA=="
    void a.play().catch(() => {})
    win.removeEventListener("pointerdown", onFirstInteraction, true)
    win.removeEventListener("keydown", onFirstInteraction, true)
  }
  win.addEventListener("pointerdown", onFirstInteraction, true)
  win.addEventListener("keydown", onFirstInteraction, true)
}

/** One-shot nudge when the widget enters `distracted` (after grace). See `FocusWidget`. */
export function speakFocusNudge() {
  if (!isUserTtsEnabled()) return
  const idx = Math.min(focusNudgeEscalation, focusMessages.length - 1)
  focusNudgeEscalation++
  const tier = Math.min(4, Math.floor(idx / 4))
  void speakFocusMessage(focusMessages[idx], false, voiceSettingsForTier(tier))
}

async function speakFocusMessage(
  text: string,
  force = false,
  voiceSettings?: ElevenLabsVoiceSettings,
) {
  if (!ENABLE_ELEVENLABS_TTS) return
  if (!isUserTtsEnabled()) return

  const now = nowSeconds()
  if (!force && now - lastSpoken < SPEECH_COOLDOWN_SECONDS) return
  lastSpoken = now

  const endpoint = getTtsEndpoint()
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice_settings: voiceSettings ?? voiceSettingsForTier(0),
      }),
    })
    if (!response.ok) {
      const errBody = await response.text().catch(() => "")
      console.warn("[focus-detection] TTS HTTP error", {
        status: response.status,
        endpoint,
        body: errBody.slice(0, 200),
      })
      return
    }
    const blob = await response.blob()
    if (blob.size < 100) {
      console.warn("[focus-detection] TTS returned tiny blob — check server / ElevenLabs response")
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    audio.onended = () => URL.revokeObjectURL(objectUrl)
    await audio.play().catch((playErr: unknown) => {
      const name = playErr instanceof DOMException ? playErr.name : ""
      console.warn("[focus-detection] TTS audio.play() failed", {
        name,
        hint:
          name === "NotAllowedError"
            ? "Click or press a key once on the extension panel, then look away again."
            : String(playErr),
      })
    })
  } catch (err) {
    console.warn("[focus-detection] TTS fetch failed — is `pnpm server` running and ELEVENLABS_API_KEY set?", {
      endpoint,
      err,
    })
  }
}

function getBox(detection: {
  boundingBox?: {
    originX: number
    originY: number
    width: number
    height: number
  }
}) {
  if (!detection?.boundingBox) return null
  return {
    x: detection.boundingBox.originX,
    y: detection.boundingBox.originY,
    width: detection.boundingBox.width,
    height: detection.boundingBox.height,
  }
}

function getKeypointByIndex(
  detection: { keypoints?: Array<{ x: number; y: number }> },
  index: number,
) {
  return detection.keypoints?.[index] ?? null
}

function toPixel(
  kp: { x: number; y: number },
  canvasW: number,
  canvasH: number,
) {
  return { x: kp.x * canvasW, y: kp.y * canvasH }
}

function analyzeDetection(
  detection: Parameters<typeof getBox>[0] & {
    keypoints?: Array<{ x: number; y: number }>
  },
  canvasWidth: number,
  canvasHeight: number,
  mode: ActivityMode,
) {
  const box = getBox(detection)

  if (!box) {
    return {
      distracted: true,
      reason: "No Face",
      eyeBalance: 1,
      noseFaceRatioX: 1,
      eyeTilt: 1,
      faceWidthRatio: 0,
      lookDownRatio: 0,
      activityMode: mode,
      lookingDown: false,
      lookingUp: false,
      faceTooSmall: true,
      poseAwayFromScreen: true,
      thresholds: FOCUS_THRESHOLDS,
      box: null,
      lookUpMargin: null,
    }
  }

  const leftEyeRaw = getKeypointByIndex(detection, 1)
  const rightEyeRaw = getKeypointByIndex(detection, 0)
  const noseTipRaw = getKeypointByIndex(detection, 2)

  const faceWidthRatioOnly = box.width / canvasWidth

  if (!leftEyeRaw || !rightEyeRaw || !noseTipRaw) {
    // If the model returns a box but no keypoints, still treat a large face as "present / likely focused".
    const distracted = faceWidthRatioOnly < MIN_FACE_WIDTH_RATIO
    return {
      distracted,
      reason: distracted ? "Face too small" : "Focused",
      eyeBalance: 0,
      noseFaceRatioX: 0,
      eyeTilt: 0,
      faceWidthRatio: faceWidthRatioOnly,
      lookDownRatio: 0,
      activityMode: mode,
      lookingDown: false,
      lookingUp: false,
      faceTooSmall: distracted,
      poseAwayFromScreen: false,
      thresholds: FOCUS_THRESHOLDS,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      lookUpMargin: null,
    }
  }

  const leftEye = toPixel(leftEyeRaw, canvasWidth, canvasHeight)
  const rightEye = toPixel(rightEyeRaw, canvasWidth, canvasHeight)
  const noseTip = toPixel(noseTipRaw, canvasWidth, canvasHeight)

  const faceCenterX = box.x + box.width / 2
  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const eyeMidY = (leftEye.y + rightEye.y) / 2
  const eyeBalance = Math.abs(noseTip.x - eyeMidX) / box.width
  const noseFaceRatioX = Math.abs(noseTip.x - faceCenterX) / box.width
  const eyeTilt = Math.abs(leftEye.y - rightEye.y) / box.height
  const faceWidthRatio = box.width / canvasWidth
  /** How far below the eye line the nose sits (screen Y down) — increases when looking down. */
  const lookDownRatio = (noseTip.y - eyeMidY) / box.height
  const lookingDown = lookDownRatio > LOOK_DOWN_THRESHOLD
  const lookUpMargin = LOOK_UP_THRESHOLD - lookDownRatio
  const lookingUp = lookUpMargin > LOOK_UP_MARGIN_MIN

  const faceTooSmall = faceWidthRatio < MIN_FACE_WIDTH_RATIO
  const poseAwayFromScreen =
    eyeBalance > EYE_BALANCE_THRESHOLD ||
    noseFaceRatioX > NOSE_FACE_RATIO_THRESHOLD ||
    eyeTilt > EYE_TILT_THRESHOLD

  let distracted: boolean
  if (mode === "video") {
    // Screen-only: eyes on the display — no glancing up (board / ceiling) or down / away.
    distracted =
      faceTooSmall ||
      poseAwayFromScreen ||
      lookingDown ||
      lookingUp
  } else if (mode === "lecture") {
    // Allow glancing up (board / instructor) — ignore yaw/tilt/down checks while head is pitched up.
    if (lookingUp) {
      distracted = faceTooSmall
    } else {
      distracted = faceTooSmall || poseAwayFromScreen || lookingDown
    }
  } else {
    // notes — can look down at paper (no lookingDown penalty); must not glance up off the notes.
    distracted =
      faceTooSmall || poseAwayFromScreen || lookingUp
  }

  let reason: string
  if (!distracted) {
    reason = "Focused"
  } else if (faceTooSmall) {
    reason = "Face too small"
  } else if ((mode === "video" || mode === "notes") && lookingUp) {
    reason = "Looking up"
  } else if (mode !== "notes" && lookingDown) {
    reason = "Looking down"
  } else {
    reason = "Not Focused"
  }

  return {
    distracted,
    reason,
    eyeBalance,
    noseFaceRatioX,
    eyeTilt,
    faceWidthRatio,
    lookDownRatio,
    activityMode: mode,
    lookingDown,
    lookingUp,
    faceTooSmall,
    poseAwayFromScreen,
    thresholds: FOCUS_THRESHOLDS,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    lookUpMargin,
  }
}

export type FocusAnalysisResult = ReturnType<typeof analyzeDetection>

/** BlazeFace short-range keypoint order (MediaPipe) — used for HUD labels. */
const BLAZE_KEYPOINT_LABELS = [
  "R eye",
  "L eye",
  "Nose",
  "Mouth",
  "R ear",
  "L ear",
] as const

function okColor(ok: boolean) {
  return ok ? "rgba(74, 222, 128, 0.95)" : "rgba(251, 146, 60, 0.95)"
}

function lectureIgnoresYawChecks(mode: ActivityMode, analysis: FocusAnalysisResult) {
  return mode === "lecture" && analysis.lookingUp
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** HUD box + crosshair for one landmark. */
function drawKeypointFeatureBox(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  label: string,
  accent: string,
) {
  const padX = 5
  ctx.save()
  ctx.font = "600 9px ui-monospace, system-ui, sans-serif"
  const tw = ctx.measureText(label).width
  const w = Math.min(120, tw + padX * 2)
  const h = 16
  const bx = px - w / 2
  const by = py - 30

  ctx.fillStyle = "rgba(0, 0, 0, 0.62)"
  drawRoundedRect(ctx, bx, by, w, h, 3)
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.25
  ctx.stroke()

  ctx.fillStyle = "#f4f4f5"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label, px, by + h / 2)

  const arm = 7
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(px - arm, py)
  ctx.lineTo(px + arm, py)
  ctx.moveTo(px, py - arm)
  ctx.lineTo(px, py + arm)
  ctx.stroke()

  const sq = 13
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.35
  ctx.strokeRect(px - sq / 2, py - sq / 2, sq, sq)
  ctx.restore()
}

function drawMetricChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  title: string,
  value: string,
  ok: boolean,
) {
  const w = 52
  const h = 28
  ctx.save()
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)"
  drawRoundedRect(ctx, x, y, w, h, 4)
  ctx.fill()
  ctx.strokeStyle = okColor(ok)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = "#a1a1aa"
  ctx.font = "600 7px ui-monospace, system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.fillText(title, x + w / 2, y + 9)
  ctx.fillStyle = ok ? "#dcfce7" : "#ffedd5"
  ctx.font = "600 9px ui-monospace, system-ui, sans-serif"
  ctx.fillText(value, x + w / 2, y + 21)
  ctx.restore()
}

/**
 * Rich overlay: face frame, all Blaze keypoint HUDs, construction lines, and metric chips
 * tied to the same thresholds as {@link analyzeDetection}.
 */
function drawFocusFeatureOverlay(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  detection: {
    keypoints?: Array<{ x: number; y: number }>
  },
  box: { x: number; y: number; width: number; height: number },
  analysis: FocusAnalysisResult,
  mode: ActivityMode,
) {
  const yawFree = lectureIgnoresYawChecks(mode, analysis)
  const eyeBalOk =
    yawFree || analysis.eyeBalance <= EYE_BALANCE_THRESHOLD
  const noseOk =
    yawFree || analysis.noseFaceRatioX <= NOSE_FACE_RATIO_THRESHOLD
  const tiltOk = yawFree || analysis.eyeTilt <= EYE_TILT_THRESHOLD
  const sizeOk = !analysis.faceTooSmall

  let pitchOk = false
  if (analysis.faceTooSmall) pitchOk = false
  else if (mode === "lecture" && analysis.lookingUp) pitchOk = true
  else if (mode === "notes") pitchOk = !analysis.lookingUp
  else if (mode === "video") pitchOk = !analysis.lookingDown && !analysis.lookingUp
  else pitchOk = !analysis.lookingDown

  const frameColor = analysis.distracted
    ? "rgba(251, 146, 60, 0.92)"
    : "rgba(74, 222, 128, 0.95)"

  ctx.save()
  ctx.lineJoin = "round"
  ctx.lineCap = "round"

  ctx.strokeStyle = frameColor
  ctx.lineWidth = 2.5
  ctx.strokeRect(box.x, box.y, box.width, box.height)
  ctx.strokeStyle = analysis.distracted
    ? "rgba(251, 146, 60, 0.35)"
    : "rgba(74, 222, 128, 0.35)"
  ctx.lineWidth = 1
  ctx.strokeRect(box.x + 3, box.y + 3, box.width - 6, box.height - 6)

  const leftRaw = getKeypointByIndex(detection, 1)
  const rightRaw = getKeypointByIndex(detection, 0)
  const noseRaw = getKeypointByIndex(detection, 2)

  if (leftRaw && rightRaw && noseRaw) {
    const leftEye = toPixel(leftRaw, cw, ch)
    const rightEye = toPixel(rightRaw, cw, ch)
    const noseTip = toPixel(noseRaw, cw, ch)
    const faceCenterX = box.x + box.width / 2
    const eyeMidX = (leftEye.x + rightEye.x) / 2
    const eyeMidY = (leftEye.y + rightEye.y) / 2

    ctx.globalAlpha = 0.9
    ctx.strokeStyle = "rgba(56, 189, 248, 0.9)"
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(leftEye.x, leftEye.y)
    ctx.lineTo(rightEye.x, rightEye.y)
    ctx.stroke()

    ctx.strokeStyle = "rgba(192, 132, 252, 0.85)"
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(box.x, eyeMidY)
    ctx.lineTo(box.x + box.width, eyeMidY)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.globalAlpha = 0.75
    ctx.strokeStyle = okColor(noseOk)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.moveTo(faceCenterX, box.y)
    ctx.lineTo(faceCenterX, box.y + box.height)
    ctx.stroke()

    ctx.strokeStyle = okColor(eyeBalOk)
    ctx.beginPath()
    ctx.moveTo(eyeMidX, box.y)
    ctx.lineTo(eyeMidX, box.y + box.height)
    ctx.stroke()

    ctx.globalAlpha = 0.95
    ctx.strokeStyle = okColor(pitchOk)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(eyeMidX, eyeMidY)
    ctx.lineTo(noseTip.x, noseTip.y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  const kps = detection.keypoints
  if (kps?.length) {
    kps.forEach((kp, i) => {
      const label = BLAZE_KEYPOINT_LABELS[i] ?? `Pt ${i}`
      const { x, y } = toPixel(kp, cw, ch)
      const hue = (i * 47) % 360
      const accent = `hsl(${hue} 85% 62%)`
      drawKeypointFeatureBox(ctx, x, y, label, accent)
    })
  }

  const stripY = Math.min(box.y + box.height + 6, ch - 36)
  const chipW = 52
  const gap = 4
  const totalW = chipW * 5 + gap * 4
  let startX = box.x + (box.width - totalW) / 2
  if (startX < 4) startX = 4
  if (startX + totalW > cw - 4) startX = cw - 4 - totalW

  drawMetricChip(
    ctx,
    startX,
    stripY,
    "EYE Δ",
    analysis.eyeBalance.toFixed(2),
    eyeBalOk,
  )
  drawMetricChip(
    ctx,
    startX + chipW + gap,
    stripY,
    "NOSE Δ",
    analysis.noseFaceRatioX.toFixed(2),
    noseOk,
  )
  drawMetricChip(
    ctx,
    startX + (chipW + gap) * 2,
    stripY,
    "TILT",
    analysis.eyeTilt.toFixed(2),
    tiltOk,
  )
  drawMetricChip(
    ctx,
    startX + (chipW + gap) * 3,
    stripY,
    "SIZE",
    analysis.faceWidthRatio.toFixed(2),
    sizeOk,
  )
  drawMetricChip(
    ctx,
    startX + (chipW + gap) * 4,
    stripY,
    "PITCH",
    analysis.lookDownRatio.toFixed(2),
    pitchOk,
  )

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)"
  ctx.font = "600 10px ui-monospace, system-ui, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const tag = analysis.distracted ? "CHECK FAIL" : "LOCKED IN"
  ctx.fillStyle = analysis.distracted ? "rgba(254, 215, 170, 0.95)" : "rgba(187, 247, 208, 0.95)"
  ctx.fillText(tag, box.x + 4, box.y + 4)

  ctx.restore()
}

function handleFocusState(distracted: boolean) {
  const bridge = window.setFocusState
  if (typeof bridge === "function") {
    bridge(!distracted)
  }
}

async function setupCamera(video: HTMLVideoElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API unavailable (use HTTPS or localhost, or grant extension camera permission)")
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  })
  video.srcObject = stream
  video.autoplay = true
  video.setAttribute("autoplay", "")
  video.muted = true

  await new Promise<void>((resolve, reject) => {
    const finish = async () => {
      try {
        await video.play()
        resolve()
      } catch (e) {
        reject(e)
      }
    }
    if (video.readyState >= 2) {
      void finish().catch(reject)
    } else {
      video.addEventListener("loadedmetadata", () => void finish().catch(reject), {
        once: true,
      })
      video.addEventListener(
        "error",
        () => reject(new Error("Video failed to load")),
        { once: true },
      )
    }
  })
}

export type FocusDetectionOptions = {
  /** Show a small camera preview (bottom-left). Default false — detection still runs. */
  showPreview?: boolean
}

/**
 * Starts webcam + MediaPipe loop. Call the returned function to stop (releases camera).
 */
export async function startFocusDetection(
  options: FocusDetectionOptions = {},
): Promise<() => void> {
  const { showPreview = false } = options

  const host = document.createElement("div")
  host.setAttribute("data-focus-detection", "")
  host.className = showPreview
    ? "fixed bottom-4 left-4 z-[9998] overflow-hidden rounded-md border border-border bg-background shadow-md"
    : // Keep a tiny non-zero footprint so browsers keep the video track running (opacity-0 / 0×0 can pause capture).
      "pointer-events-none fixed bottom-0 right-0 z-[9997] overflow-hidden opacity-[0.02]"

  const video = document.createElement("video")
  video.playsInline = true
  video.muted = true
  video.setAttribute("playsinline", "")
  video.setAttribute("webkit-playsinline", "true")
  // Min size helps WebRTC / MediaPipe; hidden mode uses small fixed dimensions.
  video.className = showPreview ? "block h-32 w-auto" : "block h-[2px] w-[2px] min-h-[2px] min-w-[2px]"

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D not available")
  const c = ctx

  const statusEl = document.createElement("div")
  statusEl.className =
    "max-w-[200px] truncate px-1 py-0.5 text-[10px] text-muted-foreground"
  statusEl.setAttribute("aria-live", "polite")

  host.appendChild(video)
  host.appendChild(canvas)
  if (showPreview) host.appendChild(statusEl)
  document.body.appendChild(host)

  focusDetectionVideoEl = video
  focusDetectionCanvasEl = canvas

  if (ENABLE_ELEVENLABS_TTS) {
    installTtsAudioUnlock(window)
  }

  await setupCamera(video)
  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 480

  const wasmRoot = mediapipeWasmRoot()
  const modelUrl = blazeFaceModelUrl()
  console.log("[focus-detection] MediaPipe assets", { wasmRoot, modelUrl })

  const vision = await FilesetResolver.forVisionTasks(wasmRoot)

  const faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl,
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.4,
    minSuppressionThreshold: 0.3,
  })

  let rafId = 0
  let stopped = false
  /** Until true, we do not call `window.setFocusState` — widget stays on `calibrating`. */
  let faceSeenOnce = false
  /**
   * MediaPipe VIDEO mode expects one `detectForVideo` per decoded frame — same `currentTime` must not
   * be processed repeatedly with new timestamps (results stay empty / unstable).
   */
  let lastVideoTime = -1
  let lastDebugLog = 0
  const DEBUG_LOG_MS = 400

  function logFocusState(payload: Record<string, unknown>) {
    const t = performance.now()
    if (t - lastDebugLog < DEBUG_LOG_MS) return
    lastDebugLog = t
    console.log("[focus-detection]", payload)
    const margin = payload.lookUpMargin
    if (typeof margin === "number") {
      console.log("[look-up]", {
        lookUpMargin: margin,
        lookDownRatio: payload.lookDownRatio,
        lookUpThreshold: LOOK_UP_THRESHOLD,
        lookUpMarginMin: LOOK_UP_MARGIN_MIN,
        lookingUp: margin > LOOK_UP_MARGIN_MIN,
      })
    }
  }

  async function loop() {
    if (stopped) return

    if (video.readyState < 2) {
      rafId = requestAnimationFrame(() => {
        void loop()
      })
      return
    }

    // One inference per new video frame (see MediaPipe Face Detector web guide).
    if (video.currentTime === lastVideoTime) {
      rafId = requestAnimationFrame(() => {
        void loop()
      })
      return
    }
    lastVideoTime = video.currentTime

    c.clearRect(0, 0, canvas.width, canvas.height)
    c.drawImage(video, 0, 0, canvas.width, canvas.height)

    const timestampMs = video.currentTime * 1000
    const result = faceDetector.detectForVideo(video, timestampMs)
    const hasFace = Boolean(result.detections?.length)

    if (!faceSeenOnce) {
      if (!hasFace) {
        statusEl.textContent = "Calibrating…"
        lastFocusDebugSnapshot = {
          phase: "calibrating",
          faceSeenOnce: false,
          detections: 0,
          videoTimeMs: timestampMs,
          videoCurrentTime: video.currentTime,
          canvas: { width: canvas.width, height: canvas.height },
          videoDisplay: {
            width: video.videoWidth,
            height: video.videoHeight,
          },
          activityMode: getActivityMode(),
          thresholds: thresholdsSnapshot(),
          status: "Calibrating…",
          note: "waiting for first face",
        }
        logFocusState({
          phase: "calibrating",
          faceSeenOnce: false,
          detections: 0,
          note: "waiting for first face",
          activityMode: getActivityMode(),
          videoTimeMs: timestampMs,
          canvas: { width: canvas.width, height: canvas.height },
          thresholds: FOCUS_THRESHOLDS,
        })
        rafId = requestAnimationFrame(() => {
          void loop()
        })
        return
      }
      faceSeenOnce = true
    }

    let distracted = false
    let statusText = "Focused"

    if (result.detections?.length) {
      const detection = result.detections.reduce(
        (
          largest: (typeof result.detections)[number],
          current: (typeof result.detections)[number],
        ) => {
          const a = getBox(largest)
          const b = getBox(current)
          const areaA = a ? a.width * a.height : 0
          const areaB = b ? b.width * b.height : 0
          return areaB > areaA ? current : largest
        },
      )

      const box = getBox(detection)
      const activityMode = getActivityMode()
      const analysis = analyzeDetection(
        detection,
        canvas.width,
        canvas.height,
        activityMode,
      )
      if (box) {
        drawFocusFeatureOverlay(
          c,
          canvas.width,
          canvas.height,
          detection,
          box,
          analysis,
          activityMode,
        )
      }
      distracted = analysis.distracted
      statusText = analysis.reason

      const detectionScore =
        (
          detection as {
            categories?: Array<{ categoryName?: string; score?: number }>
          }
        ).categories?.[0]?.score ?? null

      lastFocusDebugSnapshot = {
        phase: "tracking",
        faceSeenOnce: true,
        detections: result.detections.length,
        videoTimeMs: timestampMs,
        videoCurrentTime: video.currentTime,
        canvas: { width: canvas.width, height: canvas.height },
        videoDisplay: {
          width: video.videoWidth,
          height: video.videoHeight,
        },
        activityMode: analysis.activityMode,
        thresholds: thresholdsSnapshot(),
        detectionScore,
        status: statusText,
        distracted,
        widgetIsFocused: !distracted,
        reason: analysis.reason,
        eyeBalance: analysis.eyeBalance,
        noseFaceRatioX: analysis.noseFaceRatioX,
        eyeTilt: analysis.eyeTilt,
        faceWidthRatio: analysis.faceWidthRatio,
        lookDownRatio: analysis.lookDownRatio,
        lookingDown: analysis.lookingDown,
        lookingUp: analysis.lookingUp,
        faceTooSmall: analysis.faceTooSmall,
        poseAwayFromScreen: analysis.poseAwayFromScreen,
        lookUpMargin: analysis.lookUpMargin,
        box: analysis.box,
      }

      logFocusState({
        phase: "tracking",
        faceSeenOnce: true,
        detections: result.detections.length,
        videoTimeMs: timestampMs,
        videoCurrentTime: video.currentTime,
        canvas: { width: canvas.width, height: canvas.height },
        detectionScore,
        status: statusText,
        ...analysis,
        distracted,
        // Matches `window.setFocusState(!distracted)`
        widgetIsFocused: !distracted,
      })
    } else {
      distracted = true
      statusText = "No Face Detected"

      lastFocusDebugSnapshot = {
        phase: "tracking",
        faceSeenOnce: true,
        detections: 0,
        videoTimeMs: timestampMs,
        videoCurrentTime: video.currentTime,
        canvas: { width: canvas.width, height: canvas.height },
        videoDisplay: {
          width: video.videoWidth,
          height: video.videoHeight,
        },
        activityMode: getActivityMode(),
        thresholds: thresholdsSnapshot(),
        status: statusText,
        distracted: true,
        widgetIsFocused: false,
        note: "no face in frame",
      }

      logFocusState({
        phase: "tracking",
        faceSeenOnce: true,
        detections: 0,
        status: statusText,
        distracted: true,
        widgetIsFocused: false,
        note: "no face in frame",
        activityMode: getActivityMode(),
        videoTimeMs: timestampMs,
        videoCurrentTime: video.currentTime,
        canvas: { width: canvas.width, height: canvas.height },
        thresholds: FOCUS_THRESHOLDS,
      })
    }

    handleFocusState(distracted)
    statusEl.textContent = statusText

    rafId = requestAnimationFrame(() => {
      void loop()
    })
  }

  void loop()

  return () => {
    stopped = true
    cancelAnimationFrame(rafId)
    const stream = video.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
    video.srcObject = null
    host.remove()
    focusDetectionVideoEl = null
    focusDetectionCanvasEl = null
    lastFocusDebugSnapshot = null
    faceDetector.close?.()
  }
}
