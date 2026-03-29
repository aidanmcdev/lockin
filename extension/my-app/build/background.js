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
