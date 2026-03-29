/**
 * Presage **synchronous** upload: `POST /api/process-sync` (multipart fields `video`, `fps`).
 * Waits for the full JSON response — not the async `POST /api/process-video` flow.
 *
 * Response shape: `{ status, frames_processed, results: { vitals, attentiveness, metadata, … } }`.
 */
export const PRESAGE_PROCESS_SYNC_PATH = "/api/process-sync" as const

const DEFAULT_PRESAGE_ORIGIN = "https://distal-nisha-trigonometrically.ngrok-free.dev"

function resolveProcessSyncUrl(envUrl: string | undefined): string {
  const fallback = `${DEFAULT_PRESAGE_ORIGIN}${PRESAGE_PROCESS_SYNC_PATH}`
  const raw = envUrl?.trim()
  if (!raw) return fallback

  let u = raw.replace(/\/+$/, "")

  if (u.endsWith("/api/process-video")) {
    console.warn(
      "[lock-in] VITE_PROCESS_SYNC_URL pointed at async /api/process-video; using /api/process-sync.",
    )
    return u.replace(/\/api\/process-video$/, PRESAGE_PROCESS_SYNC_PATH)
  }

  if (u.endsWith(PRESAGE_PROCESS_SYNC_PATH)) return u

  if (!u.includes("/api/")) {
    return `${u}${PRESAGE_PROCESS_SYNC_PATH}`
  }

  return u
}

/** Full URL for synchronous process — always `/api/process-sync` unless env overrides with another path under `/api/`. */
export const PROCESS_SYNC_URL = resolveProcessSyncUrl(
  import.meta.env.VITE_PROCESS_SYNC_URL as string | undefined,
)

/** Multipart JPEG bursts — same host as {@link PROCESS_SYNC_URL}. */
export const PROCESS_FRAMES_URL = PROCESS_SYNC_URL.replace(
  /\/api\/process-sync$/,
  "/api/process-frames",
)

/** Presage `/api/process-sync` is **multipart POST** only (not GET). */
export const PROCESS_SYNC_HTTP_METHOD = "POST" as const

export type VitalsDisplayRow = { label: string; value: string }

export type ProcessSyncParsed = {
  attentiveness: string | null
  vitalsRows: VitalsDisplayRow[]
}

type ChromeRuntime = {
  sendMessage: (
    message: unknown,
    responseCallback?: (response: unknown) => void,
  ) => void
  lastError?: { message?: string }
}

function getChromeRuntime(): ChromeRuntime | undefined {
  const c = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome
  return c?.runtime
}

/**
 * Use the service worker for uploads when extension messaging exists.
 * Relying on `chrome.runtime.id` is unreliable in the panel iframe; `sendMessage` is the
 * reliable signal. Without this, the panel falls back to `fetch()` and HTTPS sites block
 * `http://` API calls (mixed content).
 */
function shouldUploadViaExtensionBackground(): boolean {
  return typeof getChromeRuntime()?.sendMessage === "function"
}

function parseBodyText(text: string): unknown {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { _raw: text }
  }
}

function fpsForProcessSyncForm(fps: number): string {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) return "30"
  const r = Math.round(fps * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, "")
}

function vitalsApiTargetLabel(): string {
  try {
    const u = new URL(PROCESS_SYNC_URL)
    return `${u.origin}${u.pathname}`
  } catch {
    return PROCESS_SYNC_URL
  }
}

function processFramesTargetLabel(): string {
  try {
    const u = new URL(PROCESS_FRAMES_URL)
    return `${u.origin}${u.pathname}`
  } catch {
    return PROCESS_FRAMES_URL
  }
}

function presageApiOrigin(): string {
  try {
    return new URL(PROCESS_SYNC_URL).origin
  } catch {
    return DEFAULT_PRESAGE_ORIGIN
  }
}

/** `GET /api/status/:jobId` after `POST /api/process-frames`. */
export function presageJobStatusUrl(jobId: string): string {
  return `${presageApiOrigin()}/api/status/${encodeURIComponent(jobId)}`
}

/** Pull a short message from typical Presage / Flask JSON error bodies. */
function parsePresageErrorFromBody(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  try {
    const j = JSON.parse(t) as unknown
    if (!isPlainObject(j)) return null
    if (typeof j.error === "string" && j.error.trim()) return j.error.trim()
    if (typeof j.message === "string" && j.message.trim()) return j.message.trim()
    if (typeof j.detail === "string" && j.detail.trim()) return j.detail.trim()
    if (Array.isArray(j.errors) && j.errors.length > 0) {
      const parts = j.errors
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .slice(0, 4)
      if (parts.length) return parts.join("; ")
    }
  } catch {
    return null
  }
  return null
}

function httpStatusHint(status: number, serverMsg: string | null): string | null {
  const m = (serverMsg || "").toLowerCase()
  if (status === 400) {
    if (
      m.includes("open video") ||
      m.includes("video file") ||
      m.includes("decode") ||
      m.includes("could not open")
    ) {
      return "The server may not read this format (WebM often needs ffmpeg). Prefer MP4 from the recorder, or ensure the Presage host can decode your container/codec."
    }
    return "Bad request—check multipart fields \"video\" and \"fps\", and that the file is a supported video format."
  }
  if (status === 401 || status === 403) {
    return "Authentication or permission denied on the vitals server."
  }
  if (status === 404) {
    return "Path not found—check Presage paths (/api/process-frames or /api/process-sync)."
  }
  if (status === 405) {
    return "Wrong HTTP method—this endpoint expects POST with multipart form data."
  }
  if (status === 413) {
    return "Payload too large; try a shorter recording or lower video bitrate."
  }
  if (status === 429) {
    return "Too many requests; wait before sending another segment."
  }
  if (status >= 500 && status < 600) {
    return "Server error—the vitals API may be down or overloaded."
  }
  return null
}

function formatProcessSyncHttpError(
  status: number,
  statusText: string,
  body: string,
  endpointLabel?: string,
): string {
  const parsed = parsePresageErrorFromBody(body)
  const st = statusText?.trim() ?? ""
  const label = endpointLabel ?? vitalsApiTargetLabel()
  const parts: string[] = [
    `Vitals sync failed: HTTP ${status}${st ? ` (${st})` : ""} from ${label}.`,
  ]
  if (parsed) {
    parts.push(`Server said: “${parsed}”.`)
  } else {
    const snip = body.trim()
    if (snip) {
      parts.push(
        `Response body: ${snip.length > 360 ? `${snip.slice(0, 360)}…` : snip}`,
      )
    } else {
      parts.push("(Empty response body.)")
    }
  }
  const hint = httpStatusHint(status, parsed)
  if (hint) parts.push(hint)
  return parts.join(" ")
}

function formatProcessSyncNetworkError(
  err: unknown,
  via: "direct_fetch" | "background",
): string {
  const raw = err instanceof Error ? err.message : String(err)
  const target = vitalsApiTargetLabel()
  const lowered = raw.toLowerCase()
  const looksLikeNetwork =
    raw === "Failed to fetch" ||
    raw.includes("NetworkError") ||
    lowered.includes("network request failed") ||
    raw.includes("Load failed") ||
    lowered.includes("load failed")

  if (!looksLikeNetwork) {
    return `Vitals sync could not complete (${via === "direct_fetch" ? "panel" : "extension background"}): ${raw} · ${target}`
  }

  if (via === "direct_fetch") {
    return [
      `Vitals sync: no network response from ${target} (“${raw}”).`,
      "On HTTPS sites the panel cannot call plain http:// APIs (mixed content).",
      "Rebuild/reload the extension so uploads go through the background worker (allowed if the API origin is in manifest host_permissions).",
    ].join(" ")
  }

  return [
    `Vitals sync: extension background could not reach ${target} (“${raw}”).`,
    "Confirm the Presage server is running and reachable, the URL matches your deployment (VITE_PROCESS_SYNC_URL or default), and manifest.json lists this origin under host_permissions.",
  ].join(" ")
}

async function uploadProcessSyncDirect(
  videoBlob: Blob,
  filename: string,
  fps: number,
): Promise<unknown> {
  const form = new FormData()
  const type = videoBlob.type || "video/webm"
  const file =
    typeof File !== "undefined"
      ? new File([videoBlob], filename, { type })
      : videoBlob
  form.append("video", file, filename)
  form.append("fps", fpsForProcessSyncForm(fps))

  let res: Response
  try {
    res = await fetch(PROCESS_SYNC_URL, {
      method: PROCESS_SYNC_HTTP_METHOD,
      body: form,
    })
  } catch (e) {
    throw new Error(formatProcessSyncNetworkError(e, "direct_fetch"))
  }

  const text = await res.text().catch(() => "")
  if (!res.ok) {
    throw new Error(
      formatProcessSyncHttpError(res.status, res.statusText, text),
    )
  }

  return parseBodyText(text)
}

async function sendExtensionWorkerMessage(payload: unknown): Promise<unknown> {
  const rt = getChromeRuntime()
  if (!rt?.sendMessage) {
    throw new Error(
      "Vitals sync needs the extension service worker: chrome.runtime messaging is missing. Reload the extension on chrome://extensions and open the panel from this extension (not a raw file or nested iframe).",
    )
  }
  return new Promise((resolve, reject) => {
    try {
      rt.sendMessage(payload, (response) => {
        const le = rt.lastError
        if (le?.message) {
          reject(
            new Error(
              `Extension message failed before request (${le.message}). Another context may be disconnected—reload the extension and try again.`,
            ),
          )
          return
        }
        resolve(response)
      })
    } catch (e) {
      reject(e)
    }
  })
}

/** Successful body text from `{ ok, status, text?, error? }` MV3 worker replies. */
function extensionWorkerFetchResultToText(
  raw: unknown,
  endpointLabel: string,
): string {
  if (raw === undefined || raw === null) {
    throw new Error(
      "Vitals: no reply from the extension background (empty response). Reload the extension on chrome://extensions.",
    )
  }

  const r = raw as {
    ok?: boolean
    status?: number
    statusText?: string
    text?: string
    error?: string
  }

  if (r.ok === true) {
    return r.text ?? ""
  }

  if (typeof r.error === "string" && r.error.trim()) {
    const msg = r.error.trim()
    if (
      msg === "Failed to fetch" ||
      msg.includes("NetworkError") ||
      msg.toLowerCase().includes("network request failed") ||
      msg.includes("Load failed")
    ) {
      throw new Error(formatProcessSyncNetworkError(new Error(msg), "background"))
    }
    if (msg.includes("Invalid vitals") || msg.includes("Invalid upload")) {
      throw new Error(
        `${msg} (${endpointLabel}). Reload the extension; if it persists, the message channel may be out of date.`,
      )
    }
    throw new Error(`Vitals (extension background): ${msg} · ${endpointLabel}`)
  }

  if (r.ok === false && typeof r.status === "number") {
    throw new Error(
      formatProcessSyncHttpError(
        r.status,
        typeof r.statusText === "string" ? r.statusText : "",
        r.text ?? "",
        endpointLabel,
      ),
    )
  }

  throw new Error(
    `Vitals: unexpected background response for ${endpointLabel}. Reload the extension. Debug: ${JSON.stringify(raw).slice(0, 280)}`,
  )
}

/**
 * Upload only via the MV3 service worker. The panel lives in an iframe on HTTPS sites
 * (e.g. YouTube); `fetch("http://…")` from that document is blocked as mixed content.
 * The background worker is `chrome-extension://` and may call `http://` hosts listed in
 * `host_permissions`.
 */
async function uploadProcessSyncViaBackgroundWorker(
  videoBlob: Blob,
  filename: string,
  fps: number,
): Promise<unknown> {
  const buffer = await videoBlob.arrayBuffer()
  const payload = {
    type: "LOCKIN_PROCESS_SYNC_UPLOAD" as const,
    method: PROCESS_SYNC_HTTP_METHOD,
    url: PROCESS_SYNC_URL,
    buffer,
    mimeType: videoBlob.type || "video/webm",
    filename,
    fps: fpsForProcessSyncForm(fps),
  }

  const raw = await sendExtensionWorkerMessage(payload)
  const text = extensionWorkerFetchResultToText(raw, vitalsApiTargetLabel())
  return parseBodyText(text)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "")
  }
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "string") return v.trim() || "—"
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const ATTENTIVENESS_KEYS = [
  "attentiveness",
  "attentiveness_score",
  "attention_score",
  "attention",
  "focus_score",
  "focus",
  "engagement",
  "engagement_score",
] as const

/** Pull a human-readable attentiveness value from common API shapes. */
function extractAttentiveness(root: Record<string, unknown>): string | null {
  for (const key of ATTENTIVENESS_KEYS) {
    if (!(key in root)) continue
    const val = root[key as string]
    if (val === undefined || val === null) continue
    if (isPlainObject(val)) {
      const nested =
        (typeof val.score === "number" || typeof val.score === "string"
          ? val.score
          : undefined) ??
        (typeof val.value === "number" || typeof val.value === "string"
          ? val.value
          : undefined)
      if (nested !== undefined) return formatScalar(nested)
      return formatScalar(val)
    }
    return formatScalar(val)
  }

  const data = root.data
  if (isPlainObject(data)) {
    const inner = extractAttentiveness(data)
    if (inner) return inner
  }

  const result = root.result
  if (isPlainObject(result)) {
    const inner = extractAttentiveness(result)
    if (inner) return inner
  }

  return null
}

/** Prefer nested `vitals`; otherwise surface numeric/string leaves that look like metrics. */
function extractVitalsRows(root: Record<string, unknown>): VitalsDisplayRow[] {
  const vitals = root.vitals ?? root.biometrics ?? root.signals
  if (isPlainObject(vitals)) {
    return Object.entries(vitals)
      .filter(([k]) => !(ATTENTIVENESS_KEYS as readonly string[]).includes(k))
      .map(([k, v]) => ({
        label: humanizeKey(k),
        value: isPlainObject(v) ? formatScalar(v) : formatScalar(v),
      }))
  }

  const data = root.data
  if (isPlainObject(data) && (data.vitals || data.biometrics)) {
    return extractVitalsRows(data)
  }

  const skip = new Set<string>([...ATTENTIVENESS_KEYS, "data", "result", "error", "message", "status", "success"])

  const rows: VitalsDisplayRow[] = []
  for (const [k, v] of Object.entries(root)) {
    if (skip.has(k)) continue
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      rows.push({ label: humanizeKey(k), value: formatScalar(v) })
    }
  }
  return rows.slice(0, 24)
}

function humanizeKey(key: string): string {
  const s = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Presage Vitals API – nested `results.vitals`, `results.attentiveness`, optional `sub_scores`.
 */
function tryParsePresageProcessSync(obj: Record<string, unknown>): ProcessSyncParsed | null {
  const results = obj.results
  if (!isPlainObject(results)) return null

  const hasVitals = isPlainObject(results.vitals)
  const hasAtt = isPlainObject(results.attentiveness)
  if (!hasVitals && !hasAtt) return null

  const vitalsRows: VitalsDisplayRow[] = []

  if (typeof obj.frames_processed === "number") {
    vitalsRows.push({
      label: "Frames processed",
      value: String(obj.frames_processed),
    })
  }
  if (typeof obj.status === "string") {
    vitalsRows.push({ label: "Job status", value: obj.status })
  }

  if (hasVitals) {
    for (const [k, v] of Object.entries(results.vitals as Record<string, unknown>)) {
      vitalsRows.push({
        label: humanizeKey(k),
        value: formatScalar(v),
      })
    }
  }

  let attentiveness: string | null = null
  if (hasAtt) {
    const att = results.attentiveness as Record<string, unknown>
    const score = att.score
    const label = att.label
    const quality = att.data_quality
    const factors = att.factors_available
    const parts: string[] = []
    if (typeof score === "number") parts.push(`Score ${score}`)
    if (typeof label === "string") {
      parts.push(humanizeKey(label.replace(/_/g, " ")))
    }
    if (typeof quality === "string") parts.push(quality)
    if (typeof factors === "number") parts.push(`${factors} factors`)
    attentiveness = parts.length ? parts.join(" · ") : null

    const sub = att.sub_scores
    if (isPlainObject(sub)) {
      for (const [key, val] of Object.entries(sub)) {
        if (!isPlainObject(val)) continue
        const s = val.score
        const detail = val.detail
        let cell = typeof s === "number" ? String(s) : ""
        if (typeof detail === "string") {
          cell = cell ? `${cell} — ${detail}` : detail
        }
        if (!cell) cell = formatScalar(val)
        vitalsRows.push({
          label: `Attentiveness · ${humanizeKey(key)}`,
          value: cell,
        })
      }
    }
  }

  const meta = results.metadata
  if (isPlainObject(meta)) {
    if (typeof meta.api_version === "string") {
      vitalsRows.push({ label: "API version", value: meta.api_version })
    }
    if (typeof meta.video_id === "string") {
      vitalsRows.push({ label: "Video id", value: meta.video_id })
    }
    if (typeof meta.frame_count === "number") {
      vitalsRows.push({
        label: "Metadata frame count",
        value: String(meta.frame_count),
      })
    }
  }

  if (typeof results.snapshot_count === "number") {
    vitalsRows.push({
      label: "Snapshot count",
      value: String(results.snapshot_count),
    })
  }

  return { attentiveness, vitalsRows }
}

/** Normalize JSON from `POST /api/process-sync` (Presage Vitals + generic fallbacks). */
export function parseProcessSyncResponse(data: unknown): ProcessSyncParsed {
  if (!isPlainObject(data)) {
    return { attentiveness: null, vitalsRows: [] }
  }

  let obj = data
  if (typeof data.payload === "string") {
    try {
      const inner = JSON.parse(data.payload) as unknown
      if (isPlainObject(inner)) obj = inner
    } catch {
      /* keep root */
    }
  }

  const presage = tryParsePresageProcessSync(obj)
  if (presage !== null && (presage.attentiveness !== null || presage.vitalsRows.length > 0)) {
    return presage
  }

  const attentiveness = extractAttentiveness(obj)
  const vitalsRows = extractVitalsRows(obj)
  return { attentiveness, vitalsRows }
}

/** Filename extension aligned with blob MIME (MP4 when MediaEncoder/Recorder produced valid). */
export function filenameForProcessSyncBlob(blob: Blob): string {
  const t = (blob.type || "").toLowerCase()
  const base = `segment-${Date.now()}`
  if (t.includes("mp4") || t.includes("mpeg")) return `${base}.mp4`
  if (t.includes("quicktime")) return `${base}.mov`
  if (t.includes("webm")) return `${base}.webm`
  return `${base}.webm`
}

const PRESAGE_POLL_INTERVAL_MS = 1500
const PRESAGE_JOB_MAX_WAIT_MS = 360_000

function buildProcessFramesFormData(frames: Blob[]): FormData {
  const form = new FormData()
  for (let i = 0; i < frames.length; i++) {
    const blob = frames[i]
    const name = `frame-${String(i).padStart(4, "0")}.jpg`
    const type = blob.type?.trim() || "image/jpeg"
    const file =
      typeof File !== "undefined"
        ? new File([blob], name, { type })
        : blob
    form.append("frames", file, name)
  }
  return form
}

async function postProcessFramesDirect(
  frames: Blob[],
  sampleFps: number,
): Promise<unknown> {
  const form = buildProcessFramesFormData(frames)
  form.append("fps", fpsForProcessSyncForm(sampleFps))

  let res: Response
  try {
    res = await fetch(PROCESS_FRAMES_URL, {
      method: PROCESS_SYNC_HTTP_METHOD,
      body: form,
    })
  } catch (e) {
    throw new Error(formatProcessSyncNetworkError(e, "direct_fetch"))
  }

  const text = await res.text().catch(() => "")
  if (!res.ok) {
    throw new Error(
      formatProcessSyncHttpError(
        res.status,
        res.statusText,
        text,
        processFramesTargetLabel(),
      ),
    )
  }
  return parseBodyText(text)
}

async function postProcessFramesViaBackground(
  frames: Blob[],
  sampleFps: number,
): Promise<unknown> {
  const parts: { buffer: ArrayBuffer; filename: string }[] = []
  for (let i = 0; i < frames.length; i++) {
    const buf = await frames[i].arrayBuffer()
    parts.push({
      buffer: buf,
      filename: `frame-${String(i).padStart(4, "0")}.jpg`,
    })
  }

  const raw = await sendExtensionWorkerMessage({
    type: "LOCKIN_PROCESS_FRAMES_UPLOAD" as const,
    method: PROCESS_SYNC_HTTP_METHOD,
    url: PROCESS_FRAMES_URL,
    fps: fpsForProcessSyncForm(sampleFps),
    frames: parts,
  })
  const text = extensionWorkerFetchResultToText(raw, processFramesTargetLabel())
  return parseBodyText(text)
}

async function presageHttpGetDirect(url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { method: "GET" })
  } catch (e) {
    throw new Error(formatProcessSyncNetworkError(e, "direct_fetch"))
  }
  const text = await res.text().catch(() => "")
  if (!res.ok) {
    let label = url
    try {
      const u = new URL(url)
      label = `${u.origin}${u.pathname}`
    } catch {
      /* keep */
    }
    throw new Error(formatProcessSyncHttpError(res.status, res.statusText, text, label))
  }
  return parseBodyText(text)
}

async function presageHttpGetViaBackground(url: string): Promise<unknown> {
  const raw = await sendExtensionWorkerMessage({
    type: "LOCKIN_PRESAGE_HTTP_GET" as const,
    url,
  })
  const text = extensionWorkerFetchResultToText(raw, url)
  return parseBodyText(text)
}

async function presageHttpGetJson(url: string): Promise<unknown> {
  if (shouldUploadViaExtensionBackground()) {
    return presageHttpGetViaBackground(url)
  }
  return presageHttpGetDirect(url)
}

async function postProcessFramesJob(
  frames: Blob[],
  sampleFps: number,
): Promise<unknown> {
  if (shouldUploadViaExtensionBackground()) {
    return postProcessFramesViaBackground(frames, sampleFps)
  }
  return postProcessFramesDirect(frames, sampleFps)
}

function extractJobId(obj: unknown): string | null {
  if (!isPlainObject(obj)) return null
  if (typeof obj.job_id === "string" && obj.job_id.trim()) return obj.job_id.trim()
  if (typeof obj.jobId === "string" && obj.jobId.trim()) return obj.jobId.trim()
  return null
}

function presagePollBodyLooksComplete(obj: unknown): boolean {
  if (!isPlainObject(obj)) return false
  const st = obj.status
  if (st === "complete" || st === "completed" || st === "done") return true
  if (isPlainObject(obj.results)) {
    const results = obj.results
    return (
      isPlainObject(results.vitals) || isPlainObject(results.attentiveness)
    )
  }
  return false
}

function presagePollBodyFailureMessage(obj: unknown): string | null {
  if (!isPlainObject(obj)) return null
  if (obj.status === "failed" || obj.status === "error") {
    const parsed = parsePresageErrorFromBody(JSON.stringify(obj))
    return parsed ?? "Job failed"
  }
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error.trim()
  return null
}

/**
 * Upload JPEG frames to `POST /api/process-frames`, then poll `GET /api/status/:jobId` until done.
 * Avoids server-side video container decoding (WebM/FFmpeg).
 */
export async function uploadVitalsJpegFrames(
  frames: Blob[],
  options: { sampleFps: number },
): Promise<unknown> {
  if (!frames.length) {
    throw new Error(
      "Vitals (JPEG frames): no frames were captured. Wait until the camera preview is live and keep your face in frame.",
    )
  }
  const sampleFps = options.sampleFps
  const submitted = await postProcessFramesJob(frames, sampleFps)

  if (presagePollBodyLooksComplete(submitted)) {
    return submitted
  }

  const jobId = extractJobId(submitted)
  if (!jobId) {
    throw new Error(
      `Vitals (frames): unexpected POST reply from ${processFramesTargetLabel()}. Expected job_id or completed results. Got: ${JSON.stringify(submitted).slice(0, 480)}`,
    )
  }

  const deadline = Date.now() + PRESAGE_JOB_MAX_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PRESAGE_POLL_INTERVAL_MS))
    const st = await presageHttpGetJson(presageJobStatusUrl(jobId))
    const fail = presagePollBodyFailureMessage(st)
    if (fail) {
      throw new Error(`Vitals job “${jobId}” failed: ${fail}`)
    }
    if (presagePollBodyLooksComplete(st)) {
      return st
    }
  }

  throw new Error(
    `Vitals job “${jobId}” timed out after ${PRESAGE_JOB_MAX_WAIT_MS / 1000}s (status URL: ${presageJobStatusUrl(jobId)}).`,
  )
}

export async function uploadProcessSyncVideo(
  videoBlob: Blob,
  options?: { fps?: number },
): Promise<unknown> {
  const filename = filenameForProcessSyncBlob(videoBlob)
  const fps =
    typeof options?.fps === "number" &&
    Number.isFinite(options.fps) &&
    options.fps > 0
      ? options.fps
      : 30
  if (shouldUploadViaExtensionBackground()) {
    return uploadProcessSyncViaBackgroundWorker(videoBlob, filename, fps)
  }
  return uploadProcessSyncDirect(videoBlob, filename, fps)
}
