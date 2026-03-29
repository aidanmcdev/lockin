import { useLayoutEffect, type RefObject } from "react"

/** Same shape as `content.jsx` listens for — iframe grows with panel content. */
export const IFRAME_PANEL_SIZE_MSG = {
  source: "lockin-extension-panel",
  type: "SIZE",
} as const

export function postIframeSizeToParent(width: number, height: number) {
  if (typeof window === "undefined" || window.parent === window) return
  window.parent.postMessage(
    {
      ...IFRAME_PANEL_SIZE_MSG,
      width: Math.ceil(width),
      height: Math.ceil(height),
    },
    "*",
  )
}

/** Resize host iframe (extension content script) to fit `el` — same pattern as FocusWidget. */
export function useIframeResizeToParent(elRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el) return

    const postSize = () => {
      const r = el.getBoundingClientRect()
      postIframeSizeToParent(r.width, r.height)
    }

    postSize()
    const ro = new ResizeObserver(() => postSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [elRef])
}
