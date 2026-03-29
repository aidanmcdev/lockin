import { useEffect, useState } from "react"
import { FocusWidget } from "./components/widget/FocusWidget"
import { AuthScreen } from "./components/auth/AuthScreen"
import { getAuth, clearAuth, type AuthUser } from "./lib/auth"

const isExtensionPanel =
  typeof window !== "undefined" && window.parent !== window

const freshSession =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("lockinFresh")

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    getAuth().then((auth) => {
      if (auth) setUser(auth.user)
      setLoading(false)
    })
  }, [])

  async function handleLogout() {
    await clearAuth()
    setUser(null)
  }

  if (loading) return null

  if (!user) {
    return (
      <AuthScreen
        onLogin={(_token, u) => setUser(u)}
      />
    )
  }

  return (
    <FocusWidget
      position="top-right"
      freshSession={freshSession}
      user={user}
      onLogout={handleLogout}
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
