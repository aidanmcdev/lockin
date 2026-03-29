const API_BASE = "https://lockin-swart.vercel.app"

async function authFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

/* ── Sessions ───────────────────────────────────────────────── */

export interface SessionEvent {
  type: "phone_detected" | "distraction" | "refocus" | "session_start" | "session_end"
  timestamp: number
  duration?: number
  details?: string
}

export interface CreateSessionPayload {
  date?: string
  attentionScore: number
  duration: number
  activityMode: "lecture" | "video" | "notes"
  focusedSeconds: number
  distractedSeconds: number
  events: SessionEvent[]
}

export function createSession(token: string, payload: CreateSessionPayload) {
  return authFetch("/api/sessions", token, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function getSessions(token: string) {
  return authFetch("/api/dashboard/sessions", token)
}

export function getDashboardStats(token: string) {
  return authFetch("/api/dashboard/stats", token)
}

/* ── Leagues / Leaderboard ──────────────────────────────────── */

export interface LeagueLeaderboardEntry {
  userId: string
  name: string
  email: string
  score: number
  rank: number
}

export interface LeagueWithLeaderboard {
  league: {
    _id: string
    name: string
    memberCount: number
  }
  leaderboard: LeagueLeaderboardEntry[]
}

export async function getLeagues(token: string): Promise<{ _id: string; name: string }[]> {
  return authFetch("/api/leagues", token)
}

export async function getLeagueLeaderboard(
  token: string,
  leagueId: string,
): Promise<LeagueWithLeaderboard> {
  return authFetch(`/api/leagues/${leagueId}`, token)
}

/* ── Friends ────────────────────────────────────────────────── */

export function getFriends(token: string) {
  return authFetch("/api/friends", token)
}

/* ── Notifications ──────────────────────────────────────────── */

export function getNotifications(token: string) {
  return authFetch("/api/notifications", token)
}
