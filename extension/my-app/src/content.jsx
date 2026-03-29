const EXT_MSG = { source: "lockin-extension", type: "CLOSE" }

const PANEL_SIZE = { source: "lockin-extension-panel", type: "SIZE" }
const BUFFER_X = 28
const BUFFER_Y = 48

/**
 * @param {{ fresh?: boolean }} [opts]
 * `fresh: true` — iframe loads with `?lockinFresh` so the widget starts at getting_started (toolbar reopen after close).
 */
function mountPanel(opts = {}) {
  const fresh = opts.fresh === true

  const existing = document.getElementById("my-extension-popup")
  if (existing) {
    existing.style.display = "block"
    return
  }

  const host = document.createElement("lockin-ext-root")
  host.id = "my-extension-popup"

  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    display: "block",
    top: "10px",
    right: "10px",
    zIndex: "2147483647",
    lineHeight: "0",
    font: "initial",
    color: "initial",
  })

  const shadow = host.attachShadow({ mode: "closed" })

  const iframe = document.createElement("iframe")
  iframe.title = "Extension panel"
  iframe.setAttribute("scrolling", "no")
  iframe.setAttribute("allow", "camera; microphone")
  Object.assign(iframe.style, {
    border: "none",
    display: "block",
    background: "transparent",
    overflow: "hidden",
    width: "320px",
    // Tall enough for auth (signup) before iframe SIZE message; panel resizes via postMessage.
    height: "420px",
  })

  const framePath = fresh ? "content-frame.html?lockinFresh=1" : "content-frame.html"
  iframe.src = chrome.runtime.getURL(framePath)

  const onWindowMessage = (event) => {
    if (event.source !== iframe.contentWindow) return

    const d = event.data

    if (d?.source === PANEL_SIZE.source && d?.type === PANEL_SIZE.type) {
      const w = Number(d.width)
      const h = Number(d.height)
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return
      iframe.style.width = `${Math.ceil(w) + BUFFER_X}px`
      iframe.style.height = `${Math.ceil(h) + BUFFER_Y}px`
      return
    }

    if (d?.source === EXT_MSG.source && d?.type === EXT_MSG.type) {
      window.removeEventListener("message", onWindowMessage)
      host.remove()
    }
  }
  window.addEventListener("message", onWindowMessage)

  shadow.appendChild(iframe)
  document.body.appendChild(host)
}

/** Show the panel, or mount it if it was removed (e.g. after ending a session). Does not hide. */
function showOrRemountPanel() {
  const host = document.getElementById("my-extension-popup")
  if (!host) {
    mountPanel({ fresh: true })
    return
  }
  host.style.display = "block"
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "LOCKIN_SHOW_EMBED") {
    showOrRemountPanel()
    sendResponse({ ok: true })
  }
  return true
})

function runWhenBodyReady(fn) {
  if (document.body) fn()
  else document.addEventListener("DOMContentLoaded", fn, { once: true })
}

runWhenBodyReady(() => {
  mountPanel()
})
