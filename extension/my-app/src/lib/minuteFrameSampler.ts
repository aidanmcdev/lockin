import { resolveVideoTrackFps } from "@/lib/minuteChunkRecorder"

export type MinuteFrameSamplerOptions = {
  getVideo: () => HTMLVideoElement | null
  /** Window length in ms; default 60_000. */
  segmentMs?: number
  /** Sampling period in ms; effective rate ≈ 1000 / interval (e.g. 500 → ~2 fps). */
  frameIntervalMs?: number
  /** JPEG quality 0–1; default 0.82. */
  jpegQuality?: number
  /** Scale frames so width ≤ this (height scales); default 640. */
  maxFrameWidth?: number
  onSegment: (
    frames: Blob[],
    meta: {
      index: number
      sampleFps: number
      trackFps: number
      frameCount: number
    },
  ) => void | Promise<void>
  /** Called when the first live frame is sampled (same role as MediaRecorder “started”). */
  onSamplingStarted?: () => void
  onError?: (err: unknown) => void
}

function captureVideoJpeg(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  maxW: number,
  quality: number,
): Promise<Blob | null> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw < 2 || vh < 2) return Promise.resolve(null)
  let tw = vw
  let th = vh
  if (tw > maxW) {
    th = Math.round((maxW / tw) * th)
    tw = maxW
  }
  canvas.width = tw
  canvas.height = th
  ctx.drawImage(video, 0, 0, tw, th)
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  })
}

/**
 * Repeated {@link segmentMs} windows of JPEG grabs from the focus-detection {@link HTMLVideoElement}.
 * Avoids sending WebM/MP4 to the server (no container decode / ffmpeg for video files).
 */
export function startMinuteFrameSampler(
  options: MinuteFrameSamplerOptions,
): () => void {
  const segmentMs = options.segmentMs ?? 60_000
  const frameIntervalMs = options.frameIntervalMs ?? 500
  const jpegQuality = options.jpegQuality ?? 0.82
  const maxFrameWidth = options.maxFrameWidth ?? 640

  let cancelled = false
  let waitTimerId = 0
  let sampleTimerId = 0
  let segmentIndex = 0
  let segmentFrames: Blob[] = []
  let segmentStartedAt = 0
  let startedEmitted = false

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    options.onError?.(
      new Error("Vitals frames: 2D canvas is unavailable in this environment."),
    )
    return () => {}
  }

  const trackFpsForMeta = (): number => {
    const v = options.getVideo()
    const stream = v?.srcObject as MediaStream | null
    const t = stream?.getVideoTracks()?.[0]
    return resolveVideoTrackFps(t)
  }

  const flushSegment = () => {
    const blobs = segmentFrames
    segmentFrames = []
    const idx = segmentIndex++
    const sampleFps = 1000 / frameIntervalMs
    const trackFps = trackFpsForMeta()
    void Promise.resolve(
      options.onSegment(blobs, {
        index: idx,
        sampleFps,
        trackFps,
        frameCount: blobs.length,
      }),
    ).catch((e) => options.onError?.(e))
  }

  const sampleOne = () => {
    if (cancelled) return
    const now = performance.now()
    if (segmentStartedAt === 0) segmentStartedAt = now

    if (now - segmentStartedAt >= segmentMs) {
      if (segmentFrames.length > 0) flushSegment()
      segmentStartedAt = now
    }

    const v = options.getVideo()
    if (!v) return
    void captureVideoJpeg(v, canvas, ctx, maxFrameWidth, jpegQuality).then(
      (blob) => {
        if (cancelled || !blob || blob.size < 32) return
        segmentFrames.push(blob)
      },
    )
  }

  const waitForVideo = () => {
    if (cancelled) return
    const v = options.getVideo()
    const stream = v?.srcObject as MediaStream | null
    const live = stream?.getVideoTracks()?.some((t) => t.readyState === "live")
    if (!v || !stream || !live || v.videoWidth < 2) return

    if (!startedEmitted) {
      startedEmitted = true
      if (waitTimerId) window.clearInterval(waitTimerId)
      waitTimerId = 0
      segmentStartedAt = 0
      options.onSamplingStarted?.()
      sampleTimerId = window.setInterval(sampleOne, frameIntervalMs)
    }
  }

  waitTimerId = window.setInterval(waitForVideo, 300)

  return () => {
    cancelled = true
    if (waitTimerId) window.clearInterval(waitTimerId)
    if (sampleTimerId) window.clearInterval(sampleTimerId)
  }
}
