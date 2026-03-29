/**
 * Presage real-time streaming client for the Chrome extension panel.
 *
 * Communication flow:
 *   Panel (this module) ──chrome.runtime.sendMessage──▶ background.js ──socket.io──▶ EC2 server
 *   Panel ◀──chrome.runtime.onMessage────────────────── background.js ◀─socket.io── EC2 server
 *
 * The background service worker holds the socket.io connection because panel iframes
 * on HTTPS pages cannot make http:// requests (mixed content).
 */

export type PresageVitals = {
  pulse_rate_bpm: number | null
  breathing_rate_bpm: number | null
  hrv_ms: number | null
  stress_index: number | null
}

export type PresageAttentiveness = {
  score: number
  label: string
  sub_scores?: Record<
    string,
    { score: number; weight: number; detail?: string }
  >
  data_quality?: string
  factors_available?: number
}

export type VitalsUpdatePayload = {
  vitals: PresageVitals
  timestamp_ms: number
  snapshot_index: number
}

export type AttentivenessUpdatePayload = {
  attentiveness: PresageAttentiveness
  elapsed_s: number
  snapshots_used: number
}

export type StreamFinalResults = {
  session_id: string
  status: string
  frames_sent: number
  snapshot_count: number
  elapsed_s: number
  vitals: PresageVitals
  attentiveness: PresageAttentiveness
}

export type PresageStreamCallbacks = {
  onStreamStarted?: (sessionId: string) => void
  onVitalsUpdate?: (payload: VitalsUpdatePayload) => void
  onAttentivenessUpdate?: (payload: AttentivenessUpdatePayload) => void
  onStreamStopped?: (results: StreamFinalResults) => void
  onError?: (message: string) => void
  onConnectionChange?: (connected: boolean) => void
}

type ChromeRuntime = {
  sendMessage: (
    message: unknown,
    responseCallback?: (response: unknown) => void,
  ) => void
  onMessage: {
    addListener: (
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => void,
    ) => void
    removeListener: (
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => void,
    ) => void
  }
  lastError?: { message?: string }
}

function getChromeRuntime(): ChromeRuntime | undefined {
  const c = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome
  return c?.runtime
}

/**
 * Manages a real-time streaming session via the background service worker.
 * The background worker holds the actual socket.io connection.
 */
export class PresageStreamClient {
  private callbacks: PresageStreamCallbacks
  private listener:
    | ((
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => void)
    | null = null
  private _connected = false

  constructor(callbacks: PresageStreamCallbacks) {
    this.callbacks = callbacks
    this.setupListener()
  }

  private setupListener(): void {
    const rt = getChromeRuntime()
    if (!rt) return

    this.listener = (message: unknown) => {
      const msg = message as { type?: string; [key: string]: unknown }
      if (!msg?.type?.startsWith("LOCKIN_PRESAGE_STREAM_")) return

      switch (msg.type) {
        case "LOCKIN_PRESAGE_STREAM_STARTED":
          this._connected = true
          this.callbacks.onConnectionChange?.(true)
          this.callbacks.onStreamStarted?.(msg.session_id as string)
          break
        case "LOCKIN_PRESAGE_STREAM_VITALS":
          this.callbacks.onVitalsUpdate?.(msg.payload as VitalsUpdatePayload)
          break
        case "LOCKIN_PRESAGE_STREAM_ATTENTIVENESS":
          this.callbacks.onAttentivenessUpdate?.(
            msg.payload as AttentivenessUpdatePayload,
          )
          break
        case "LOCKIN_PRESAGE_STREAM_STOPPED":
          this._connected = false
          this.callbacks.onConnectionChange?.(false)
          this.callbacks.onStreamStopped?.(
            msg.payload as StreamFinalResults,
          )
          break
        case "LOCKIN_PRESAGE_STREAM_ERROR":
          this.callbacks.onError?.(msg.message as string)
          break
        case "LOCKIN_PRESAGE_STREAM_DISCONNECTED":
          this._connected = false
          this.callbacks.onConnectionChange?.(false)
          break
      }
    }

    rt.onMessage.addListener(this.listener)
  }

  /** Tell background worker to connect and start streaming. */
  start(fps = 5): void {
    const rt = getChromeRuntime()
    if (!rt?.sendMessage) {
      this.callbacks.onError?.(
        "Extension messaging unavailable. Reload the extension.",
      )
      return
    }
    rt.sendMessage({ type: "LOCKIN_PRESAGE_STREAM_START", fps })
  }

  /** Send a JPEG frame (as base64) via the background worker. */
  sendFrame(base64Jpeg: string): void {
    const rt = getChromeRuntime()
    if (!rt?.sendMessage || !this._connected) return
    rt.sendMessage({ type: "LOCKIN_PRESAGE_STREAM_FRAME", data: base64Jpeg })
  }

  /** Tell background worker to stop the stream. */
  stop(): void {
    const rt = getChromeRuntime()
    if (!rt?.sendMessage) return
    rt.sendMessage({ type: "LOCKIN_PRESAGE_STREAM_STOP" })
  }

  /** Clean up the message listener. */
  destroy(): void {
    const rt = getChromeRuntime()
    if (rt && this.listener) {
      rt.onMessage.removeListener(this.listener)
      this.listener = null
    }
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected
  }
}

/**
 * Captures JPEG frames from a video element and streams them via PresageStreamClient.
 * Returns a cleanup function to stop capturing.
 */
export type FrameStreamStatus = {
  phase: "waiting_video" | "sampling"
  fps: number
  intervalMs: number
}

/** Wall-clock targets for UI countdowns; only used when burst/cooldown throttling is enabled. */
export type RateLimitSchedule = {
  phase: "burst" | "cooldown"
  burstWindowMs: number
  cooldownMs: number
  burstEndsAt: number | null
  cooldownEndsAt: number | null
}

export function startPresageFrameStream(options: {
  getVideo: () => HTMLVideoElement | null
  client: PresageStreamClient
  fps?: number
  jpegQuality?: number
  maxFrameWidth?: number
  /**
   * Send frames for at most this long, then pause (requires `cooldownBetweenBurstsMs` > 0).
   * Omit or `0` to stream continuously (no API throttle).
   */
  burstWindowMs?: number
  /**
   * After each burst, do not send frames for this many ms (saves API credits).
   * Omit or `0` to disable throttling.
   */
  cooldownBetweenBurstsMs?: number
  /** When burst/cooldown boundaries change (for UI). */
  onRateLimitSchedule?: (schedule: RateLimitSchedule) => void
  /** Fires when waiting for a live video frame vs when JPEG sampling has started. */
  onFrameStreamStatus?: (status: FrameStreamStatus) => void
  /** Fires after each frame is encoded and passed to the socket (same cadence as `intervalMs`). */
  onFrameSent?: (info: { index: number; sentAt: number }) => void
}): () => void {
  const fps = options.fps ?? 5
  const jpegQuality = options.jpegQuality ?? 0.7
  const maxFrameWidth = options.maxFrameWidth ?? 640
  const intervalMs = 1000 / fps
  const burstWindowMs = options.burstWindowMs ?? 0
  const cooldownBetweenBurstsMs = options.cooldownBetweenBurstsMs ?? 0
  const rateLimitEnabled =
    burstWindowMs > 0 && cooldownBetweenBurstsMs > 0

  let cancelled = false
  let waitTimerId = 0
  let sampleTimerId = 0
  let frameIndex = 0
  let reportedWaiting = false

  let ratePhase: "burst" | "cooldown" = "burst"
  let burstStartedAt = 0
  let cooldownStartedAt = 0

  const emitRateLimit = (phase: RateLimitSchedule["phase"]) => {
    if (!rateLimitEnabled) return
    if (phase === "burst") {
      options.onRateLimitSchedule?.({
        phase: "burst",
        burstWindowMs,
        cooldownMs: cooldownBetweenBurstsMs,
        burstEndsAt: burstStartedAt + burstWindowMs,
        cooldownEndsAt: null,
      })
    } else {
      options.onRateLimitSchedule?.({
        phase: "cooldown",
        burstWindowMs,
        cooldownMs: cooldownBetweenBurstsMs,
        burstEndsAt: null,
        cooldownEndsAt: cooldownStartedAt + cooldownBetweenBurstsMs,
      })
    }
  }

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return () => {}

  const emitStatus = (phase: FrameStreamStatus["phase"]) => {
    options.onFrameStreamStatus?.({ phase, fps, intervalMs })
  }

  const captureAndSend = () => {
    if (cancelled) return
    const now = Date.now()

    if (rateLimitEnabled) {
      if (ratePhase === "cooldown") {
        if (now - cooldownStartedAt < cooldownBetweenBurstsMs) {
          return
        }
        ratePhase = "burst"
        burstStartedAt = now
        emitRateLimit("burst")
      }

      if (ratePhase === "burst") {
        if (burstStartedAt === 0) {
          burstStartedAt = now
          emitRateLimit("burst")
        }
        if (now - burstStartedAt >= burstWindowMs) {
          ratePhase = "cooldown"
          cooldownStartedAt = now
          emitRateLimit("cooldown")
          return
        }
      }
    }

    const video = options.getVideo()
    if (!video || video.videoWidth < 2) return

    let tw = video.videoWidth
    let th = video.videoHeight
    if (tw > maxFrameWidth) {
      th = Math.round((maxFrameWidth / tw) * th)
      tw = maxFrameWidth
    }
    canvas.width = tw
    canvas.height = th
    ctx.drawImage(video, 0, 0, tw, th)

    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality)
    const b64 = dataUrl.split(",")[1]
    if (b64) {
      options.client.sendFrame(b64)
      frameIndex++
      options.onFrameSent?.({ index: frameIndex, sentAt: Date.now() })
    }
  }

  const waitForVideo = () => {
    if (cancelled) return
    const v = options.getVideo()
    const stream = v?.srcObject as MediaStream | null
    const live = stream
      ?.getVideoTracks()
      ?.some((t) => t.readyState === "live")
    if (!v || !stream || !live || v.videoWidth < 2) {
      if (!reportedWaiting) {
        reportedWaiting = true
        emitStatus("waiting_video")
      }
      return
    }

    if (waitTimerId) {
      window.clearInterval(waitTimerId)
      waitTimerId = 0
    }
    reportedWaiting = false
    emitStatus("sampling")
    sampleTimerId = window.setInterval(captureAndSend, intervalMs)
  }

  emitStatus("waiting_video")
  reportedWaiting = true
  waitTimerId = window.setInterval(waitForVideo, 300)

  return () => {
    cancelled = true
    if (waitTimerId) window.clearInterval(waitTimerId)
    if (sampleTimerId) window.clearInterval(sampleTimerId)
  }
}
