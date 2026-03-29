import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { setAuth, type AuthUser } from "@/lib/auth"

const API_BASE = "https://lockin-swart.vercel.app"

interface AuthScreenProps {
  onLogin: (token: string, user: AuthUser) => void
}

export function AuthScreen({ onLogin }: AuthScreenProps) {
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
    <div className="flex items-center justify-center min-h-[240px] p-4">
      <Card className="w-full max-w-[300px]">
        <CardHeader className="pb-3">
          <CardTitle className="text-center text-lg">
            {mode === "login" ? "Lock In" : "Create Account"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <Input
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {error && (
              <p className="text-xs text-destructive text-center">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "..."
                : mode === "login"
                  ? "Log In"
                  : "Sign Up"}
            </Button>
          </form>
          <button
            type="button"
            className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground text-center"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login")
              setError("")
            }}
          >
            {mode === "login"
              ? "Don't have an account? Sign up"
              : "Already have an account? Log in"}
          </button>
        </CardContent>
      </Card>
    </div>
  )
}
