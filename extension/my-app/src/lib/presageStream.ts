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
export function startPresageFrameStream(options: {
  getVideo: () => HTMLVideoElement | null
  client: PresageStreamClient
  fps?: number
  jpegQuality?: number
  maxFrameWidth?: number
}): () => void {
  const fps = options.fps ?? 5
  const jpegQuality = options.jpegQuality ?? 0.7
  const maxFrameWidth = options.maxFrameWidth ?? 640
  const intervalMs = 1000 / fps

  let cancelled = false
  let waitTimerId = 0
  let sampleTimerId = 0

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return () => {}

  const captureAndSend = () => {
    if (cancelled) return
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
    }
  }

  const waitForVideo = () => {
    if (cancelled) return
    const v = options.getVideo()
    const stream = v?.srcObject as MediaStream | null
    const live = stream
      ?.getVideoTracks()
      ?.some((t) => t.readyState === "live")
    if (!v || !stream || !live || v.videoWidth < 2) return

    if (waitTimerId) {
      window.clearInterval(waitTimerId)
      waitTimerId = 0
    }
    sampleTimerId = window.setInterval(captureAndSend, intervalMs)
  }

  waitTimerId = window.setInterval(waitForVideo, 300)

  return () => {
    cancelled = true
    if (waitTimerId) window.clearInterval(waitTimerId)
    if (sampleTimerId) window.clearInterval(sampleTimerId)
  }
}
