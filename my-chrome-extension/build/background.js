// // Open extention after inital load
// chrome.action.openPopup().catch((err) => console.error("Failed:", err));

// // Open up the tab after you switch tabs
// function tryOpenPopup(tab) {
//   if (!tab.active) return;
//   setTimeout(() => {
//     chrome.action.openPopup().catch((err) => console.error("Failed:", err));
//   }, 100); // small delay
// }

// chrome.tabs.onActivated.addListener((activeInfo) => {
//   chrome.tabs.get(activeInfo.tabId, tryOpenPopup);
// });

// chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//   if (changeInfo.status === "complete") tryOpenPopup(tab);
// });

// chrome.windows.onFocusChanged.addListener((windowId) => {
//   // Chrome lost focus
//   if (windowId === chrome.windows.WINDOW_ID_NONE) return;

//   // Get the active tab in this window
//   chrome.tabs.query({ active: true, windowId }, (tabs) => {
//     if (tabs[0]) {
//       setTimeout(() => {
//         chrome.action.openPopup().catch((err) => console.error("Failed:", err));
//       }, 100); // small delay helps
//     }
//   });
// });

// browser.runtime.onMessage.addListener((message, sender) => {
//   if (message.type === "popup_closed") {
//     console.log("Popup was closed!", sender);
//     // You can handle it however you want
//   }
// });
