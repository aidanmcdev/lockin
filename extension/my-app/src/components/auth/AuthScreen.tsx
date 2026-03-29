import { useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { setAuth, type AuthUser } from "@/lib/auth"
import { useIframeResizeToParent } from "@/lib/iframeParentSize"
import { cn } from "@/lib/utils"

const API_BASE = "https://lockin-swart.vercel.app"

interface AuthScreenProps {
  onLogin: (token: string, user: AuthUser) => void
}

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useIframeResizeToParent(rootRef)

  const [mode, setMode] = useState<"login" | "signup">("login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const url =
      mode === "login"
        ? `${API_BASE}/api/auth/login`
        : `${API_BASE}/api/auth/register`

    const body =
      mode === "login"
        ? { email, password }
        : { name, email, password }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.message || "Something went wrong")
        setLoading(false)
        return
      }

      await setAuth(data.token, data.user)
      onLogin(data.token, data.user)
    } catch {
      setError("Cannot reach server. Is it running?")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col items-center justify-center bg-transparent p-3"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      <Card
        className={cn(
          "w-72 max-w-[96vw] overflow-hidden border shadow-lg",
          "bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80",
        )}
      >
        {/* Match FocusWidget header strip */}
        <div className="flex shrink-0 items-center border-b border-border bg-muted/25 px-3 py-2.5">
          <span className="text-sm font-semibold tracking-tight">Lock-In.tech</span>
        </div>

        <CardContent className="space-y-0 p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Name
                </label>
                <Input
                  id="auth-name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="bg-background"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label
                htmlFor="auth-email"
                className="text-xs font-medium text-muted-foreground"
              >
                Email
              </label>
              <Input
                id="auth-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="auth-password"
                className="text-xs font-medium text-muted-foreground"
              >
                Password
              </label>
              <Input
                id="auth-password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="bg-background"
              />
            </div>
            {error ? (
              <Alert variant="destructive" className="py-2">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Please wait…"
                : mode === "login"
                  ? "Log in"
                  : "Sign up"}
            </Button>
          </form>

          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login")
                setError("")
              }}
            >
              {mode === "login"
                ? "Don't have an account? Sign up"
                : "Already have an account? Log in"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
