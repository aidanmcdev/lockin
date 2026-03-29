/**
 * Toolbar icon has no popup — each click shows / remounts the embed (`content.js`).
 * Panel also mounts automatically when a tab loads; the icon is for reopening after
 * a session ends (embed is torn down) or if the user dismissed it.
 */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  chrome.tabs
    .sendMessage(tab.id, { type: "LOCKIN_SHOW_EMBED" })
    .catch(() => {
      /* e.g. chrome:// URLs, or page where content script cannot run */
    })
})

function normalizeWorkerPostMethod(method) {
  const httpMethod =
    method === undefined || method === null
      ? "POST"
      : typeof method === "string"
        ? method.toUpperCase()
        : "POST"
  return httpMethod
}

function sendFetchError(sendResponse, err) {
  const msg = err instanceof Error ? err.message : String(err)
  const detail =
    msg === "Failed to fetch"
      ? `${msg} (background could not open a network connection—check server, URL, and manifest host_permissions for the API origin).`
      : msg
  sendResponse({
    ok: false,
    error: detail,
  })
}

/**
 * Vitals API traffic from the panel: multipart POST and GET poll must run here so
 * HTTPS pages are not blocked from calling http:// Presage (mixed content).
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const t = message?.type

  if (t === "LOCKIN_PROCESS_SYNC_UPLOAD") {
    const { url, buffer, mimeType, filename, fps, method } = message
    if (typeof url !== "string" || !buffer) {
      sendResponse({
        ok: false,
        error:
          "Invalid vitals upload message: expected url (string) and video buffer. Reload the extension if this appears after an update.",
      })
      return true
    }

    const httpMethod = normalizeWorkerPostMethod(method)
    if (httpMethod !== "POST") {
      sendResponse({
        ok: false,
        error: `process-sync must use POST, not ${httpMethod}`,
      })
      return true
    }

    const name =
      typeof filename === "string" && filename.trim()
        ? filename.trim()
        : "segment.webm"
    const type =
      typeof mimeType === "string" && mimeType.trim()
        ? mimeType.trim()
        : "video/webm"
    const file =
      typeof File !== "undefined"
        ? new File([buffer], name, { type })
        : new Blob([buffer], { type })
    const form = new FormData()
    form.append("video", file, name)
    const fpsPart =
      typeof fps === "string" && fps.trim()
        ? fps.trim()
        : typeof fps === "number" && Number.isFinite(fps) && fps > 0
          ? String(fps)
          : "30"
    form.append("fps", fpsPart)

    fetch(url, { method: httpMethod, body: form })
      .then(async (res) => {
        const text = await res.text().catch(() => "")
        sendResponse({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          text,
        })
      })
      .catch((err) => sendFetchError(sendResponse, err))

    return true
  }

  if (t === "LOCKIN_PROCESS_FRAMES_UPLOAD") {
    const { url, frames, fps, method } = message
    if (typeof url !== "string" || !Array.isArray(frames) || frames.length === 0) {
      sendResponse({
        ok: false,
        error:
          "Invalid vitals frames message: expected url and non-empty frames[]. Reload the extension after an update if this persists.",
      })
      return true
    }

    const httpMethod = normalizeWorkerPostMethod(method)
    if (httpMethod !== "POST") {
      sendResponse({
        ok: false,
        error: `process-frames must use POST, not ${httpMethod}`,
      })
      return true
    }

    const form = new FormData()
    for (let i = 0; i < frames.length; i++) {
      const part = frames[i]
      const buffer = part?.buffer
      const fn =
        typeof part?.filename === "string" && part.filename.trim()
          ? part.filename.trim()
          : `frame-${String(i).padStart(4, "0")}.jpg`
      if (!buffer) {
        sendResponse({
          ok: false,
          error: `Invalid vitals frames: missing buffer at index ${i}.`,
        })
        return true
      }
      const file =
        typeof File !== "undefined"
          ? new File([buffer], fn, { type: "image/jpeg" })
          : new Blob([buffer], { type: "image/jpeg" })
      form.append("frames", file, fn)
    }

    const fpsPart =
      typeof fps === "string" && fps.trim()
        ? fps.trim()
        : typeof fps === "number" && Number.isFinite(fps) && fps > 0
          ? String(fps)
          : "2"
    form.append("fps", fpsPart)

    fetch(url, { method: httpMethod, body: form })
      .then(async (res) => {
        const text = await res.text().catch(() => "")
        sendResponse({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          text,
        })
      })
      .catch((err) => sendFetchError(sendResponse, err))

    return true
  }

  if (t === "LOCKIN_PRESAGE_HTTP_GET") {
    const { url } = message
    if (typeof url !== "string" || !url.trim()) {
      sendResponse({
        ok: false,
        error: "LOCKIN_PRESAGE_HTTP_GET requires a non-empty url string.",
      })
      return true
    }

    fetch(url.trim(), { method: "GET" })
      .then(async (res) => {
        const text = await res.text().catch(() => "")
        sendResponse({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          text,
        })
      })
      .catch((err) => sendFetchError(sendResponse, err))

    return true
  }

  return undefined
})
