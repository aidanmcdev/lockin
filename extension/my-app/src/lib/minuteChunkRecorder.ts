/** Reported camera / track FPS for Presage `multipart` field `fps`. */
export function resolveVideoTrackFps(track: MediaStreamTrack | undefined): number {
  if (!track || track.readyState !== "live") return 30
  const s = track.getSettings()
  if (
    typeof s.frameRate === "number" &&
    Number.isFinite(s.frameRate) &&
    s.frameRate > 0
  ) {
    return s.frameRate
  }
  const caps = track.getCapabilities?.() as
    | (MediaTrackCapabilities & { frameRate?: { min?: number; max?: number } })
    | undefined
  const fr = caps?.frameRate
  if (
    fr &&
    typeof fr === "object" &&
    typeof fr.max === "number" &&
    Number.isFinite(fr.max) &&
    fr.max > 0
  ) {
    return fr.max
  }
  return 30
}

export type MinuteChunkRecorderOptions = {
  getStream: () => MediaStream | null
  /** Defaults to 60_000 (1 minute). */
  intervalMs?: number
  onChunk: (
    blob: Blob,
    meta: { index: number; fps: number },
  ) => void | Promise<void>
  /** Called once {@link MediaRecorder} has started on a live stream. */
  onRecordingStarted?: () => void
  onError?: (err: unknown) => void
}

/** Bitrate cap for both MP4 and WebM (smaller uploads, fewer timeouts). */
const VIDEO_BITS_PER_SECOND = 1_600_000

/**
 * Prefer MP4 **H.264 (avc1)** — many vitals APIs require it. Our camera stream is **video-only**
 * (`audio: false`), so try **video-only** `codecs=avc1…` first (works reliably on macOS Chrome;
 * muxed `avc1+mp4a` is a fallback). Then WebM.
 */
function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined

  const candidates = [
    // Video-only H.264 first (matches getUserMedia { video, audio: false })
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1.42E01F",
    "video/mp4;codecs=avc1.4d401E",
    "video/mp4;codecs=avc1.4d401e",
    "video/mp4;codecs=avc1.64001F",
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1",
    "video/mp4",
    // Muxed A/V types (some browsers only advertise these)
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4d401e,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.5",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return undefined
}

function createRecorder(stream: MediaStream, mimeType: string | undefined): MediaRecorder {
  const withRate = (): MediaRecorder => {
    const opts: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS_PER_SECOND }
    if (mimeType) opts.mimeType = mimeType
    return new MediaRecorder(stream, opts)
  }
  const basic = (): MediaRecorder =>
    mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

  try {
    return withRate()
  } catch {
    return basic()
  }
}

/**
 * Records {@link intervalMs} chunks from the camera stream (same track as focus detection when
 * {@link getStream} returns that element's `srcObject`).
 *
 * @returns Stop function — stops polling, ends recording, and flushes a final blob via `onChunk`.
 */
export function startMinuteChunkRecorder(
  options: MinuteChunkRecorderOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 60_000
  let recorder: MediaRecorder | null = null
  let cancelled = false
  let chunkIndex = 0
  let pollId = 0

  const attach = (stream: MediaStream) => {
    if (cancelled) return
    const mimeType = pickRecorderMimeType()
    try {
      recorder = createRecorder(stream, mimeType)
    } catch (err) {
      options.onError?.(err)
      return
    }

    const rec = recorder
    rec.addEventListener("dataavailable", (ev) => {
      if (ev.data.size === 0) return
      const idx = chunkIndex++
      const track = stream.getVideoTracks()[0]
      const fps = resolveVideoTrackFps(track)
      void Promise.resolve(
        options.onChunk(ev.data, { index: idx, fps }),
      ).catch((e) => options.onError?.(e))
    })

    rec.addEventListener("error", () => {
      options.onError?.(new Error("MediaRecorder error"))
    })

    try {
      rec.start(intervalMs)
      options.onRecordingStarted?.()
    } catch (err) {
      options.onError?.(err)
    }
  }

  pollId = window.setInterval(() => {
    if (cancelled) return
    const stream = options.getStream()
    const videoTracks = stream?.getVideoTracks() ?? []
    const live = videoTracks.some((t) => t.readyState === "live")
    if (!stream || !live) return

    window.clearInterval(pollId)
    pollId = 0
    attach(stream)
  }, 300)

  return () => {
    cancelled = true
    if (pollId) window.clearInterval(pollId)
    const rec = recorder
    recorder = null
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }
}
