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

// ============================================================================
// Socket.io streaming — managed in background worker to avoid mixed-content
// ============================================================================

importScripts("socket.io.min.js")

const PRESAGE_ORIGIN = "https://distal-nisha-trigonometrically.ngrok-free.dev"
let presageSocket = null
let streamSenderTabId = null

function broadcastToAllTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
    }
  })
}

function startPresageStream(fps) {
  if (presageSocket) {
    presageSocket.disconnect()
    presageSocket = null
  }

  try {
    presageSocket = io(PRESAGE_ORIGIN, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    })

    presageSocket.on("connect", () => {
      console.log("[presage-bg] connected, starting stream at", fps, "fps")
      presageSocket.emit("start_stream", { fps })
    })

    presageSocket.on("disconnect", (reason) => {
      console.log("[presage-bg] disconnected:", reason)
      broadcastToAllTabs({ type: "LOCKIN_PRESAGE_STREAM_DISCONNECTED" })
    })

    presageSocket.on("connect_error", (err) => {
      console.error("[presage-bg] connection error:", err.message)
      broadcastToAllTabs({
        type: "LOCKIN_PRESAGE_STREAM_ERROR",
        message: "Connection failed: " + err.message,
      })
    })

    presageSocket.on("stream_started", (data) => {
      console.log("[presage-bg] stream started:", data.session_id)
      broadcastToAllTabs({
        type: "LOCKIN_PRESAGE_STREAM_STARTED",
        session_id: data.session_id,
      })
    })

    presageSocket.on("vitals_update", (data) => {
      broadcastToAllTabs({
        type: "LOCKIN_PRESAGE_STREAM_VITALS",
        payload: data,
      })
    })

    presageSocket.on("attentiveness_update", (data) => {
      broadcastToAllTabs({
        type: "LOCKIN_PRESAGE_STREAM_ATTENTIVENESS",
        payload: data,
      })
    })

    presageSocket.on("stream_stopped", (data) => {
      console.log("[presage-bg] stream stopped")
      broadcastToAllTabs({
        type: "LOCKIN_PRESAGE_STREAM_STOPPED",
        payload: data.final_results,
      })
    })

    presageSocket.on("error", (data) => {
      broadcastToAllTabs({
        type: "LOCKIN_PRESAGE_STREAM_ERROR",
        message: data.message || "Unknown server error",
      })
    })
  } catch (err) {
    console.error("[presage-bg] failed to create socket:", err)
    broadcastToAllTabs({
      type: "LOCKIN_PRESAGE_STREAM_ERROR",
      message: "Failed to create socket: " + (err.message || String(err)),
    })
  }
}

function sendPresageFrame(base64Jpeg) {
  if (presageSocket && presageSocket.connected) {
    presageSocket.emit("frame", { data: base64Jpeg })
  }
}

function stopPresageStream() {
  if (presageSocket) {
    if (presageSocket.connected) {
      presageSocket.emit("stop_stream")
    }
    // Give server time to send final results before disconnecting
    setTimeout(() => {
      if (presageSocket) {
        presageSocket.disconnect()
        presageSocket = null
      }
    }, 3000)
  }
}

// ============================================================================
// Message handler — vitals API traffic + streaming
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const t = message?.type

  // --- Streaming messages ---

  if (t === "LOCKIN_PRESAGE_STREAM_START") {
    const fps = typeof message.fps === "number" ? message.fps : 5
    streamSenderTabId = sender.tab?.id ?? null
    startPresageStream(fps)
    sendResponse({ ok: true })
    return true
  }

  if (t === "LOCKIN_PRESAGE_STREAM_FRAME") {
    sendPresageFrame(message.data)
    // No response needed for frames — fire and forget
    return false
  }

  if (t === "LOCKIN_PRESAGE_STREAM_STOP") {
    stopPresageStream()
    sendResponse({ ok: true })
    return true
  }

  // --- Existing batch upload messages ---

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
