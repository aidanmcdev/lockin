import { FocusWidget } from "./components/widget/FocusWidget"

const isExtensionPanel =
  typeof window !== "undefined" && window.parent !== window

const freshSession =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("lockinFresh")

export default function App() {
  return (
    <FocusWidget
      position="top-right"
      freshSession={freshSession}
      onClose={
        isExtensionPanel
          ? () => {
              window.parent.postMessage(
                { source: "lockin-extension", type: "CLOSE" },
                "*",
              )
            }
          : undefined
      }
    />
  )
}
