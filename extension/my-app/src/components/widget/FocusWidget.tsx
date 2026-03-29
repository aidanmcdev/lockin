"use client"

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FocusStatus, type FocusState } from "@/components/widget/FocusState"
import {
  ActivityModeRow,
  type ActivityMode,
} from "@/components/widget/ActivityModeRow"
import { Leaderboard, type LeaderboardEntry } from "@/components/widget/Leaderboard"
import { Activity, LogOut, Maximize2, Mic, MicOff, Minimize2, Settings, X } from "lucide-react"
import {
  getFocusDebugSnapshot,
  getFocusDetectionCanvas,
  getFocusDetectionVideo,
  speakFocusNudge,
  startFocusDetection,
  STEADY_DISTRACTED_NUDGE_MS,
  type FocusDebugSnapshot,
} from "@/focusDetection"
import { formatAdjustedAttentivenessScore } from "@/lib/attentivenessScore"
import {
  type ProcessSyncParsed,
} from "@/lib/processSyncApi"
import {
  PresageStreamClient,
  startPresageFrameStream,
  type RateLimitSchedule,
  type VitalsUpdatePayload,
  type AttentivenessUpdatePayload,
} from "@/lib/presageStream"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  hydrateWidgetState,
  parsePersistedWidgetStateJson,
  readLegacySessionElapsedOnly,
  SESSION_ELAPSED_STORAGE_KEY,
  WIDGET_STATE_STORAGE_KEY,
  writePersistedWidgetState,
} from "@/lib/widgetStateStorage"
import {
  createSession,
  getLeagues,
  getLeagueLeaderboard,
  type SessionEvent,
} from "@/lib/api"
import { useIframeResizeToParent } from "@/lib/iframeParentSize"

export type WidgetPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"

export interface FocusWidgetProps {
  /** Initial UI phase; default `getting_started` (pick length → tap time → then `calibrating` / focus pipeline). */
  initialFocusState?: FocusState
  /** Starting session length in whole minutes (converted to elapsed seconds on mount). */
  focusDuration?: number
  sessionGoal?: number // in minutes
  /** Grace period length in seconds when entering `warning` (countdown + progress bar). */
  graceTotal?: number

  // Leaderboard
  leaderboardEntries?: LeaderboardEntry[]
  currentUserRank?: number
  totalParticipants?: number
  
  /** `bottom-*` anchors the widget by its bottom edge — when content grows taller, it expands upward. Use `top-*` for expand-down (e.g. extension panel at the top of the viewport). */
  position?: WidgetPosition
  onClose?: () => void
  /** Called when the header settings (gear) control is activated. */
  onSettings?: () => void
  /** Webcam + MediaPipe; set false for UI-only demos. */
  enableCameraFocusDetection?: boolean
  /**
   * When true, ignore `lockin-widget-state-v1` on first mount (fresh getting_started).
   * Used when reopening the extension panel via the toolbar after closing a session.
   */
  freshSession?: boolean

  /** Authenticated user info. */
  user?: { id: string; name: string; email: string }
  /** JWT token for API calls. */
  token?: string
  /** Called when the user logs out. */
  onLogout?: () => void

  // Styling
  className?: string
}

const defaultLeaderboardEntries: LeaderboardEntry[] = []

/** Legacy segment length label for timers; live stream uses JPEG interval + socket push cadence. */
const VITALS_SEGMENT_MS = 60_000
/** Frames per second sent to Presage over socket.io (matches `PresageStreamClient.start`). */
const VITALS_STREAM_FPS = 5
/** One “video” burst to the API — then {@link PRESAGE_API_COOLDOWN_MS} gap (credit control). */
const PRESAGE_BURST_WINDOW_MS = 30_000
/** Pause frame uploads after each burst so Presage credits are not consumed continuously. */
const PRESAGE_API_COOLDOWN_MS = 5 * 60_000

type StreamTransportState = {
  sessionId: string | null
  framePhase: "waiting_video" | "sampling"
  framesSent: number
  lastFrameSentAt: number | null
  lastVitalsAt: number | null
  lastAttentivenessAt: number | null
  /** Latest of vitals or attentiveness push (for “last payload in”). */
  lastServerPayloadAt: number | null
  /** Set after first frame when burst/cooldown throttling is enabled. */
  rateLimit: RateLimitSchedule | null
}

type VitalsSyncPhaseModel =
  | "idle"
  | "waiting_camera"
  | "recording"
  | "uploading"

type VitalsUploadLogEntry = {
  chunkIndex: number
  ok: boolean
  finishedAt: number
  bytes: number
  /** Camera / multipart `fps` (process-sync). */
  fps?: number
  /** MediaRecorder / blob MIME (e.g. video/webm, video/mp4). */
  mimeType?: string
  /** Name sent in multipart (e.g. segment-….webm). */
  filename?: string
  errorMessage?: string
}

export function FocusWidget({
  initialFocusState = "getting_started",
  focusDuration = 42,
  sessionGoal = 60,
  graceTotal = 10,
  leaderboardEntries = defaultLeaderboardEntries,
  currentUserRank,
  totalParticipants,
  position = "bottom-right",
  onClose,
  onSettings,
  enableCameraFocusDetection = true,
  freshSession = false,
  user,
  token,
  onLogout,
  className,
}: FocusWidgetProps) {
  const initialHydrated = useMemo(
    () =>
      hydrateWidgetState({
        initialFocusState,
        focusDuration,
        sessionGoal,
        graceTotal,
        ignorePersisted: freshSession,
      }),
    // Restore from localStorage once on mount (props are first-render defaults).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [focusState, setFocusState] = useState<FocusState>(
    initialHydrated.focusState,
  )
  const [sessionGoalMinutes, setSessionGoalMinutes] = useState(
    initialHydrated.sessionGoalMinutes,
  )
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(
    initialHydrated.sessionElapsedSeconds,
  )
  const [graceRemaining, setGraceRemaining] = useState(
    initialHydrated.graceRemaining,
  )
  const [isVisible, setIsVisible] = useState(true)
  const [isEntering, setIsEntering] = useState(true)
  const [activityMode, setActivityMode] = useState<ActivityMode>(
    initialHydrated.activityMode,
  )
  const [minimized, setMinimized] = useState(initialHydrated.minimized)
  const [settingsOpen, setSettingsOpen] = useState(initialHydrated.settingsOpen)
  const [ttsEnabled, setTtsEnabled] = useState(initialHydrated.ttsEnabled)
  const rootRef = useRef<HTMLDivElement>(null)
  const settingsCanvasRef = useRef<HTMLCanvasElement>(null)
  const prevFocusStateRef = useRef<FocusState | undefined>(undefined)
  const [focusDebugSnap, setFocusDebugSnap] = useState<FocusDebugSnapshot | null>(
    null,
  )

  // ── Session event tracking for backend sync ──
  const sessionEventsRef = useRef<SessionEvent[]>([])
  const focusedSecondsRef = useRef(0)
  const distractedSecondsRef = useRef(0)
  const sessionStartedAtRef = useRef<number | null>(null)

  // ── Live leaderboard data from leagues API ──
  const [liveLeaderboard, setLiveLeaderboard] = useState<LeaderboardEntry[] | null>(null)
  const [liveUserRank, setLiveUserRank] = useState<number | undefined>(undefined)
  const [liveTotalParticipants, setLiveTotalParticipants] = useState<number | undefined>(undefined)
  const [leaderboardRefreshing, setLeaderboardRefreshing] = useState(false)

  type VitalsSyncSnapshot = ProcessSyncParsed & {
    chunkIndex: number
    recordedAt: number
    /** Camera track reported FPS. */
    segmentFps: number
    /** Same value sent as multipart `fps` (often matches camera track). */
    segmentUploadFps: number
    segmentMimeType: string
    segmentFilename: string
    /** Latest attentiveness sub-scores from socket (replaced on each push). */
    attentivenessSubRows?: { label: string; value: string }[]
  }

  const [vitalsSyncPhase, setVitalsSyncPhase] =
    useState<VitalsSyncPhaseModel>("idle")
  const [vitalsSyncError, setVitalsSyncError] = useState<string | null>(null)
  const [vitalsSyncSnapshot, setVitalsSyncSnapshot] =
    useState<VitalsSyncSnapshot | null>(null)
  const [vitalsWaitCameraStartedAt, setVitalsWaitCameraStartedAt] = useState<
    number | null
  >(null)
  const [vitalsRecordingStartedAt, setVitalsRecordingStartedAt] = useState<
    number | null
  >(null)
  const [vitalsSegmentStartedAt, setVitalsSegmentStartedAt] = useState<
    number | null
  >(null)
  const [vitalsUploadLog, setVitalsUploadLog] = useState<VitalsUploadLogEntry[]>(
    [],
  )
  const [vitalsLiveTick, setVitalsLiveTick] = useState(0)
  const [streamTransport, setStreamTransport] =
    useState<StreamTransportState | null>(null)
  // vitalsUploadChainRef removed — streaming mode doesn't need upload chaining

  const safeGraceTotal = Math.max(1, graceTotal)

  /** Persist full UI state so new tabs / reloads match where you left off. */
  useEffect(() => {
    writePersistedWidgetState({
      v: 1,
      focusState,
      sessionGoalMinutes,
      sessionElapsedSeconds,
      graceRemaining,
      activityMode,
      minimized,
      ttsEnabled,
      settingsOpen,
    })
  }, [
    focusState,
    sessionGoalMinutes,
    sessionElapsedSeconds,
    graceRemaining,
    activityMode,
    minimized,
    ttsEnabled,
    settingsOpen,
  ])

  /** Other tabs / surfaces update `lockin-widget-state-v1` — stay in sync. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== WIDGET_STATE_STORAGE_KEY || e.newValue === null) return
      const p = parsePersistedWidgetStateJson(e.newValue)
      if (!p) return
      if (p.focusState !== undefined) setFocusState(p.focusState)
      if (p.sessionGoalMinutes !== undefined) {
        setSessionGoalMinutes(p.sessionGoalMinutes)
      }
      if (p.sessionElapsedSeconds !== undefined) {
        setSessionElapsedSeconds(p.sessionElapsedSeconds)
      }
      if (p.graceRemaining !== undefined) setGraceRemaining(p.graceRemaining)
      if (p.activityMode !== undefined) setActivityMode(p.activityMode)
      if (p.minimized !== undefined) setMinimized(p.minimized)
      if (p.ttsEnabled !== undefined) setTtsEnabled(p.ttsEnabled)
      if (p.settingsOpen !== undefined) setSettingsOpen(p.settingsOpen)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  /** Track focus-state transitions as session events for backend sync. */
  useEffect(() => {
    const prev = prevFocusStateRef.current
    const ts = sessionElapsedSeconds
    if (prev === undefined) { /* first render — skip */ }
    else if (focusState === "distracted" && prev !== "distracted") {
      sessionEventsRef.current.push({ type: "distraction", timestamp: ts, details: "User became distracted" })
    } else if (focusState === "focused" && (prev === "distracted" || prev === "warning")) {
      sessionEventsRef.current.push({ type: "refocus", timestamp: ts, details: "User refocused" })
    } else if (focusState === "calibrating" && prev === "getting_started") {
      sessionEventsRef.current.push({ type: "session_start", timestamp: ts, details: "Session started" })
      sessionStartedAtRef.current = Date.now()
      focusedSecondsRef.current = 0
      distractedSecondsRef.current = 0
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusState])

  /** Accumulate focused vs distracted seconds each tick. */
  useEffect(() => {
    if (focusState !== "focused" && focusState !== "warning" && focusState !== "distracted") return
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      if (focusState === "focused" || focusState === "warning") {
        focusedSecondsRef.current += 1
      } else if (focusState === "distracted") {
        distractedSecondsRef.current += 1
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [focusState])

  /** First ElevenLabs line when entering `distracted` (after grace). */
  useEffect(() => {
    const prev = prevFocusStateRef.current
    prevFocusStateRef.current = focusState
    if (prev === undefined) return
    if (focusState === "distracted" && prev !== "distracted") {
      void speakFocusNudge()
    }
  }, [focusState])

  /** While stuck in `distracted`, keep nudging on an interval — lines escalate via `focusNudgeEscalation`. */
  useEffect(() => {
    if (focusState !== "distracted") return
    const id = window.setInterval(() => {
      void speakFocusNudge()
    }, STEADY_DISTRACTED_NUDGE_MS)
    return () => window.clearInterval(id)
  }, [focusState])

  /** Face / gaze pipeline calls `window.setFocusState(true|false)` each frame — map into widget states. */
  useEffect(() => {
    window.setFocusState = (isFocused: boolean) => {
      setFocusState((prev) => {
        if (prev === "getting_started") return prev
        if (isFocused) return "focused"
        if (prev === "focused") return "warning"
        if (prev === "warning") return "warning"
        if (prev === "distracted") return "distracted"
        return "warning"
      })
    }
    return () => {
      delete window.setFocusState
    }
  }, [])

  /** MediaPipe reads mode each frame — lecture vs video vs notes changes which pose rules apply. */
  useEffect(() => {
    window.getActivityMode = () => activityMode
    return () => {
      delete window.getActivityMode
    }
  }, [activityMode])

  /** Voice nudges (ElevenLabs) — `focusDetection` checks before speaking. */
  useEffect(() => {
    window.getTtsEnabled = () => ttsEnabled
    return () => {
      delete window.getTtsEnabled
    }
  }, [ttsEnabled])

  /** Webcam + MediaPipe — only after the user leaves “getting started”. Depends on `pastSetup`, not every `focusState`, so we don’t restart on focused ↔ warning. */
  const pastGettingStarted = focusState !== "getting_started"
  useEffect(() => {
    if (!enableCameraFocusDetection || !pastGettingStarted) return

    let cancelled = false
    let cleanup: (() => void) | undefined
    startFocusDetection({ showPreview: false })
      .then((stop) => {
        if (cancelled) stop()
        else cleanup = stop
      })
      .catch((err) => {
        console.error("[focus-detection] failed to start:", err)
      })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [enableCameraFocusDetection, pastGettingStarted])

  /** Live timers in Settings (waiting / total record / segment progress). */
  useEffect(() => {
    if (!enableCameraFocusDetection || !pastGettingStarted) return
    if (vitalsWaitCameraStartedAt === null && vitalsRecordingStartedAt === null) {
      return
    }
    const id = window.setInterval(() => {
      setVitalsLiveTick((n) => n + 1)
    }, 500)
    return () => window.clearInterval(id)
  }, [
    enableCameraFocusDetection,
    pastGettingStarted,
    vitalsWaitCameraStartedAt,
    vitalsRecordingStartedAt,
  ])

  /** Real-time frame streaming via socket.io → Presage SmartSpectra C++ SDK. */
  useEffect(() => {
    if (!enableCameraFocusDetection || !pastGettingStarted) {
      setVitalsSyncPhase("idle")
      setVitalsWaitCameraStartedAt(null)
      setVitalsRecordingStartedAt(null)
      setVitalsSegmentStartedAt(null)
      setVitalsUploadLog([])
      setStreamTransport(null)
      return
    }

    setVitalsSyncPhase("waiting_camera")
    setVitalsSyncError(null)
    setVitalsWaitCameraStartedAt(Date.now())
    setVitalsRecordingStartedAt(null)
    setVitalsSegmentStartedAt(null)
    setVitalsUploadLog([])
    setStreamTransport({
      sessionId: null,
      framePhase: "waiting_video",
      framesSent: 0,
      lastFrameSentAt: null,
      lastVitalsAt: null,
      lastAttentivenessAt: null,
      lastServerPayloadAt: null,
      rateLimit: null,
    })

    let streamSnapshotIndex = 0

    const client = new PresageStreamClient({
      onStreamStarted: (sessionId) => {
        const t = Date.now()
        setVitalsWaitCameraStartedAt(null)
        setVitalsRecordingStartedAt(t)
        setVitalsSegmentStartedAt(t)
        setVitalsSyncPhase("recording")
        setVitalsSyncError(null)
        setStreamTransport((prev) =>
          prev ? { ...prev, sessionId: sessionId ?? null } : prev,
        )
        console.log("[vitals-stream] stream started", sessionId)
      },
      onVitalsUpdate: (payload: VitalsUpdatePayload) => {
        streamSnapshotIndex++
        const vitalsRows = Object.entries(payload.vitals)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => ({
            label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            value: typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v ?? "—"),
          }))
        const ts = payload.timestamp_ms ?? Date.now()
        setVitalsSyncSnapshot((prev) => ({
          attentiveness: prev?.attentiveness ?? null,
          attentivenessSubRows: prev?.attentivenessSubRows,
          vitalsRows,
          chunkIndex: streamSnapshotIndex,
          recordedAt: Date.now(),
          segmentFps: VITALS_STREAM_FPS,
          segmentUploadFps: VITALS_STREAM_FPS,
          segmentMimeType: "stream",
          segmentFilename: "live-stream",
        }))
        setStreamTransport((prev) =>
          prev
            ? { ...prev, lastVitalsAt: ts, lastServerPayloadAt: ts }
            : prev,
        )
        setVitalsSyncError(null)
      },
      onAttentivenessUpdate: (payload: AttentivenessUpdatePayload) => {
        const att = payload.attentiveness
        const adjustedScore = formatAdjustedAttentivenessScore(att.score)
        const label = `Score ${adjustedScore} · ${att.label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`
        const attentivenessSubRows: { label: string; value: string }[] = []
        if (att.sub_scores) {
          for (const [key, val] of Object.entries(att.sub_scores)) {
            attentivenessSubRows.push({
              label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              value:
                typeof val.detail === "string"
                  ? `${val.score} — ${val.detail}`
                  : String(val.score),
            })
          }
        }

        // Record attentiveness event for session timeline
        const scoreNum = typeof adjustedScore === "number" ? adjustedScore : parseFloat(String(adjustedScore))
        if (!isNaN(scoreNum)) {
          const elapsed = sessionStartedAtRef.current
            ? Math.round((Date.now() - sessionStartedAtRef.current) / 1000)
            : 0
          sessionEventsRef.current.push({
            type: "attentiveness",
            timestamp: elapsed,
            value: Math.round(scoreNum),
            details: `Attentiveness: ${Math.round(scoreNum)}%`,
          })
        }

        const now = Date.now()
        setVitalsSyncSnapshot((prev) => ({
          attentiveness: label,
          attentivenessSubRows,
          vitalsRows: prev?.vitalsRows ?? [],
          chunkIndex: prev?.chunkIndex ?? streamSnapshotIndex,
          recordedAt: now,
          segmentFps: prev?.segmentFps ?? VITALS_STREAM_FPS,
          segmentUploadFps: prev?.segmentUploadFps ?? VITALS_STREAM_FPS,
          segmentMimeType: prev?.segmentMimeType ?? "stream",
          segmentFilename: prev?.segmentFilename ?? "live-stream",
        }))
        setStreamTransport((prev) =>
          prev
            ? {
                ...prev,
                lastAttentivenessAt: now,
                lastServerPayloadAt: now,
              }
            : prev,
        )
      },
      onError: (message: string) => {
        console.error("[vitals-stream] error:", message)
        setVitalsSyncError(message)
      },
      onConnectionChange: (connected: boolean) => {
        if (!connected) {
          setVitalsSyncPhase("idle")
          setStreamTransport(null)
        }
      },
    })

    client.start(VITALS_STREAM_FPS)

    const stopFrameCapture = startPresageFrameStream({
      getVideo: getFocusDetectionVideo,
      client,
      fps: VITALS_STREAM_FPS,
      jpegQuality: 0.7,
      maxFrameWidth: 640,
      burstWindowMs: PRESAGE_BURST_WINDOW_MS,
      cooldownBetweenBurstsMs: PRESAGE_API_COOLDOWN_MS,
      onRateLimitSchedule: (schedule) => {
        setStreamTransport((prev) =>
          prev ? { ...prev, rateLimit: schedule } : prev,
        )
      },
      onFrameStreamStatus: ({ phase }) => {
        setStreamTransport((prev) =>
          prev ? { ...prev, framePhase: phase } : prev,
        )
      },
      onFrameSent: ({ index, sentAt }) => {
        setStreamTransport((prev) =>
          prev
            ? {
                ...prev,
                framesSent: index,
                lastFrameSentAt: sentAt,
              }
            : prev,
        )
      },
    })

    return () => {
      stopFrameCapture()
      client.stop()
      // Give the server a moment to send final results before disconnecting
      setTimeout(() => client.destroy(), 2000)
      setVitalsSyncPhase("idle")
      setVitalsWaitCameraStartedAt(null)
      setVitalsRecordingStartedAt(null)
      setVitalsSegmentStartedAt(null)
      setVitalsUploadLog([])
      setStreamTransport(null)
    }
  }, [enableCameraFocusDetection, pastGettingStarted])

  // When entering warning, start (or restart) the grace countdown from full duration.
  useEffect(() => {
    if (focusState !== "warning") return
    setGraceRemaining(safeGraceTotal)
  }, [focusState, safeGraceTotal])

  // Count down every second; when time is up, switch to distracted.
  useEffect(() => {
    if (focusState !== "warning") return
    const id = window.setInterval(() => {
      setGraceRemaining((prev) => {
        if (prev <= 1) {
          setFocusState("distracted")
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [focusState, safeGraceTotal])

  // Session timer: advance while focused or in warning; persists to localStorage and syncs across tabs.
  useEffect(() => {
    if (
      focusState !== "focused" &&
      focusState !== "warning"
    )
      return

    const tick = () => {
      if (document.visibilityState !== "visible") return
      setSessionElapsedSeconds((s) => s + 1)
    }

    const id = window.setInterval(tick, 1000)

    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_ELAPSED_STORAGE_KEY || e.newValue === null) return
      const n = Number.parseInt(e.newValue, 10)
      if (Number.isFinite(n) && n >= 0) setSessionElapsedSeconds(n)
    }
    window.addEventListener("storage", onStorage)

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        const v = readLegacySessionElapsedOnly()
        if (v !== null) setSessionElapsedSeconds(v)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      window.clearInterval(id)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [focusState])

  useIframeResizeToParent(rootRef)

  // Entry animation
  useEffect(() => {
    const timer = setTimeout(() => setIsEntering(false), 300)
    return () => clearTimeout(timer)
  }, [])

  /** Copy detection canvas (frame + face box) into Settings while open. */
  useEffect(() => {
    if (!settingsOpen || !enableCameraFocusDetection) return
    let raf = 0
    let stopped = false

    const tick = () => {
      if (stopped) return
      const src = getFocusDetectionCanvas()
      const dst = settingsCanvasRef.current
      if (src && dst && src.width > 0 && src.height > 0) {
        if (dst.width !== src.width) dst.width = src.width
        if (dst.height !== src.height) dst.height = src.height
        dst.getContext("2d")?.drawImage(src, 0, 0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [settingsOpen, enableCameraFocusDetection])

  /** Poll debug snapshot for the data panel (full frame rate not needed). */
  useEffect(() => {
    if (!settingsOpen || !enableCameraFocusDetection) return
    setFocusDebugSnap(getFocusDebugSnapshot())
    const id = window.setInterval(() => {
      setFocusDebugSnap(getFocusDebugSnapshot())
    }, 120)
    return () => window.clearInterval(id)
  }, [settingsOpen, enableCameraFocusDetection])


  /** Fetch league leaderboard — reusable for mount + manual refresh. */
  const refreshLeaderboard = useCallback(async () => {
    if (!token || !user) return
    setLeaderboardRefreshing(true)
    try {
      const leagues = await getLeagues(token)
      if (!leagues.length) return
      const data = await getLeagueLeaderboard(token, leagues[0]._id)

      const entries: LeaderboardEntry[] = data.leaderboard.map((m, i) => ({
        id: m.userId,
        name: m.name,
        focusTime: Math.round(m.score),
        rank: m.rank ?? i + 1,
        isCurrentUser: m.userId === user.id,
      }))

      const myEntry = entries.find((e) => e.isCurrentUser)
      setLiveLeaderboard(entries)
      setLiveUserRank(myEntry?.rank)
      setLiveTotalParticipants(data.league.memberCount ?? entries.length)
    } catch (err) {
      console.warn("[lockin] Could not fetch leaderboard:", err)
    } finally {
      setLeaderboardRefreshing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id])

  /** Fetch league leaderboard on mount when authenticated. */
  useEffect(() => {
    refreshLeaderboard()
  }, [refreshLeaderboard])

  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => {
      onClose?.()
    }, 200)
  }, [onClose])

  const handleEndSession = useCallback(() => {
    // Capture values before resetting
    const elapsed = sessionElapsedSeconds
    const focused = focusedSecondsRef.current
    const distracted = distractedSecondsRef.current
    const events = [...sessionEventsRef.current]
    const mode = activityMode

    // Add session_end event
    events.push({ type: "session_end", timestamp: elapsed, details: "Session ended" })

    // Send session to backend
    if (token && elapsed > 0) {
      const total = focused + distracted || 1
      const attentionScore = Math.round((focused / total) * 100)
      const durationMinutes = Math.round(elapsed / 60)

      createSession(token, {
        attentionScore,
        duration: durationMinutes,
        activityMode: mode,
        focusedSeconds: focused,
        distractedSeconds: distracted,
        events,
      }).catch((err) => console.error("[lockin] Failed to save session:", err))
    }

    // Reset tracking
    sessionEventsRef.current = []
    focusedSecondsRef.current = 0
    distractedSecondsRef.current = 0
    sessionStartedAtRef.current = null

    // Ensure future tabs (and refresh) don't rehydrate into an in-progress session.
    // Reset persisted state (instead of clearing) so preferences stay in sync across tabs.
    writePersistedWidgetState({
      v: 1,
      focusState: "getting_started",
      sessionGoalMinutes,
      sessionElapsedSeconds: 0,
      graceRemaining: safeGraceTotal,
      activityMode,
      minimized,
      ttsEnabled,
      settingsOpen: false,
    })
    setSessionElapsedSeconds(0)
    setGraceRemaining(safeGraceTotal)
    setFocusState("getting_started")
    setSettingsOpen(false)
    handleClose()
  }, [
    handleClose,
    sessionElapsedSeconds,
    token,
    sessionGoalMinutes,
    safeGraceTotal,
    activityMode,
    minimized,
    ttsEnabled,
  ])

  const adjustSessionGoal = useCallback((deltaMinutes: number) => {
    setSessionGoalMinutes((m) =>
      Math.min(240, Math.max(5, m + deltaMinutes)),
    )
  }, [])

  const handleStartSessionFromSetup = useCallback(() => {
    setSessionElapsedSeconds(0)
    setFocusState("calibrating")
  }, [])

  const positionClasses = {
    "bottom-right": "bottom-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "top-right": "top-4 right-4",
    "top-left": "top-4 left-4",
  }

  const sessionMinutesElapsed = sessionElapsedSeconds / 60
  const sessionProgress =
    sessionGoalMinutes > 0
      ? Math.min((sessionMinutesElapsed / sessionGoalMinutes) * 100, 100)
      : 0
  const graceProgress =
    safeGraceTotal > 0 ? (graceRemaining / safeGraceTotal) * 100 : 0
  const isWarning = focusState === "warning"
  const isDistracted = focusState === "distracted"
  const isCalibrating = focusState === "calibrating"
  const isGettingStarted = focusState === "getting_started"
  const barWidthPct = isWarning
    ? graceProgress
    : isGettingStarted
      ? 0
      : sessionProgress

  const vitalsLiveNowMs = Date.now() + 0 * vitalsLiveTick
  const vitalsLiveForSettings =
    enableCameraFocusDetection && (pastGettingStarted || vitalsUploadLog.length > 0)
      ? {
          nowMs: vitalsLiveNowMs,
          waitCameraStartedAt: vitalsWaitCameraStartedAt,
          recordingStartedAt: vitalsRecordingStartedAt,
          segmentStartedAt: vitalsSegmentStartedAt,
          segmentTargetMs: VITALS_SEGMENT_MS,
          phase: vitalsSyncPhase,
          uploads: vitalsUploadLog,
          transport: streamTransport,
          streamFps: VITALS_STREAM_FPS,
        }
      : undefined

  if (!isVisible) return null

  return (
    <div
      ref={rootRef}
      data-extension-widget-root
      className={cn(
        "fixed z-[9999] transition-all duration-300",
        positionClasses[position],
        (position === "top-right" || position === "top-left") && "origin-top",
        (position === "bottom-right" || position === "bottom-left") &&
          "origin-bottom",
        isEntering && "scale-95 opacity-0",
        !isEntering && "scale-100 opacity-100",
        className
      )}
      style={{
        // Isolated styles to prevent conflicts with host page
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <Card
        className={cn(
          "border shadow-lg",
          settingsOpen
            ? "flex max-h-[min(90vh,calc(100vh-2rem))] w-[min(28rem,calc(100vw-1.25rem))] max-w-[96vw] flex-col overflow-hidden"
            : "w-72 overflow-hidden",
          "bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
        )}
      >
        {/* Header — title left; TTS, minimize, settings, close on the right */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold tracking-tight">FocusUp.tech</span>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "size-6 text-muted-foreground hover:text-foreground",
                ttsEnabled && "text-foreground",
              )}
              aria-pressed={ttsEnabled}
              aria-label={
                ttsEnabled ? "Turn voice nudges off" : "Turn voice nudges on"
              }
              onClick={() => setTtsEnabled((v) => !v)}
            >
              {ttsEnabled ? (
                <Mic className="size-3.5" aria-hidden />
              ) : (
                <MicOff className="size-3.5 opacity-70" aria-hidden />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-expanded={!minimized}
              aria-label={minimized ? "Expand panel" : "Minimize panel"}
              onClick={() => setMinimized((m) => !m)}
            >
              {minimized ? (
                <Maximize2 className="size-3.5" aria-hidden />
              ) : (
                <Minimize2 className="size-3.5" aria-hidden />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "size-6 text-muted-foreground hover:text-foreground",
                settingsOpen && "bg-muted text-foreground",
              )}
              aria-pressed={settingsOpen}
              aria-expanded={settingsOpen}
              aria-label={settingsOpen ? "Close settings" : "Open settings"}
              onClick={() => {
                setSettingsOpen((prev) => {
                  const next = !prev
                  if (next) onSettings?.()
                  return next
                })
              }}
            >
              <Settings className="size-3.5" />
            </Button>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={handleEndSession}
              >
                <X className="size-3.5" />
                <span className="sr-only">Close widget</span>
              </Button>
            )}
          </div>
        </div>

        {settingsOpen ? (
          <div
            className="flex min-h-0 flex-1 flex-col bg-muted/30"
            role="region"
            aria-label="Settings"
          >
            <div className="shrink-0 border-b border-border/80 bg-muted/30 px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold tracking-tight">Settings</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setSettingsOpen(false)}
                >
                  Done
                </Button>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-5 py-4"
              tabIndex={0}
            >
              {enableCameraFocusDetection ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Detection overlay
                    </p>
                    <canvas
                      ref={settingsCanvasRef}
                      className="aspect-video w-full max-w-xl rounded-md border border-border bg-black object-contain"
                      aria-label="Face detection preview with bounding box"
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Frame data
                    </p>
                    <FocusDebugSnapshotPanel snap={focusDebugSnap} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Camera focus detection is off — enable it to see the detection preview and metrics.
                </p>
              )}

              <div
                className={cn("space-y-2", enableCameraFocusDetection && "mt-6")}
              >
                <p className="text-xs font-medium text-muted-foreground">
                  Vitals sync
                </p>
                <VitalsSyncPanel
                  phase={
                    enableCameraFocusDetection ? vitalsSyncPhase : "idle"
                  }
                  error={enableCameraFocusDetection ? vitalsSyncError : null}
                  snapshot={
                    enableCameraFocusDetection ? vitalsSyncSnapshot : null
                  }
                  cameraDisabled={!enableCameraFocusDetection}
                  live={vitalsLiveForSettings}
                />
              </div>

              {onLogout && (
                <div className="mt-6 border-t border-border/60 pt-4">
                  {user && (
                    <p className="mb-2 text-xs text-muted-foreground truncate">
                      Signed in as {user.name}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5"
                    onClick={onLogout}
                  >
                    <LogOut className="size-3" />
                    Log out
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <CardContent className="space-y-4 p-3">
            <FocusStatus
              status={focusState}
              sessionElapsedSeconds={sessionElapsedSeconds}
              sessionGoalMinutes={sessionGoalMinutes}
              onAdjustSessionGoal={adjustSessionGoal}
              onStartSessionFromSetup={handleStartSessionFromSetup}
              onEndSession={
                focusState === "getting_started" ? undefined : handleEndSession
              }
            />

            {!minimized && (
              <>
                {/* Session progress vs grace-period warning bar */}
                <div className="space-y-3">
                  <div
                    className="space-y-1.5"
                    data-progress-mode={
                      isGettingStarted
                        ? "getting_started"
                        : isCalibrating
                          ? "calibrating"
                          : isWarning
                            ? "warning"
                            : isDistracted
                              ? "distracted"
                              : "session"
                    }
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {isGettingStarted
                          ? "Session goal"
                          : isCalibrating
                            ? "Calibrating"
                            : isWarning
                              ? "Time to refocus"
                              : "Session progress"}
                      </span>
                      <span>
                        {isGettingStarted
                          ? `0m / ${sessionGoalMinutes}m`
                          : isWarning
                            ? `${graceRemaining}s remaining`
                            : `${Math.floor(sessionMinutesElapsed)}m / ${sessionGoalMinutes}m`}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "relative h-1.5 w-full overflow-hidden rounded-full border-0",
                        isGettingStarted &&
                          "bg-muted ring-1 ring-border",
                        isCalibrating &&
                          "bg-blue-500/20 ring-1 ring-blue-500/35",
                        isWarning && "bg-yellow-500/20 ring-1 ring-yellow-500/35",
                        isDistracted && "bg-amber-500/20 ring-1 ring-amber-500/35",
                        !isGettingStarted &&
                          !isCalibrating &&
                          !isWarning &&
                          !isDistracted &&
                          "bg-emerald-500/20 ring-1 ring-emerald-500/35",
                      )}
                    >
                      <div
                        key={
                          isGettingStarted
                            ? "getting_started"
                            : isCalibrating
                              ? "calibrating"
                              : isWarning
                                ? "grace"
                                : isDistracted
                                  ? "distracted"
                                  : "session"
                        }
                        className={cn(
                          "box-border h-full min-h-[6px] rounded-full border-0",
                          isGettingStarted &&
                            "!bg-violet-500 transition-[width] duration-300",
                          isCalibrating &&
                            "!bg-blue-500 transition-[width] duration-300",
                          isWarning &&
                            "!bg-yellow-500 transition-[width] duration-1000 ease-linear",
                          isDistracted &&
                            "!bg-amber-500 transition-[width] duration-300",
                          !isGettingStarted &&
                            !isCalibrating &&
                            !isWarning &&
                            !isDistracted &&
                            "!bg-emerald-500 transition-[width] duration-300",
                        )}
                        style={{ width: `${barWidthPct}%` }}
                      />
                    </div>
                  </div>

                  <ActivityModeRow
                    value={activityMode}
                    onValueChange={setActivityMode}
                  />
                </div>

                {(liveLeaderboard ?? leaderboardEntries).length > 0 && (
                  <Leaderboard
                    entries={liveLeaderboard ?? leaderboardEntries}
                    currentUserRank={liveUserRank ?? currentUserRank}
                    totalParticipants={liveTotalParticipants ?? totalParticipants}
                    onRefresh={refreshLeaderboard}
                    refreshing={leaderboardRefreshing}
                  />
                )}
              </>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

function formatDebugValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(3) : String(value)
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function formatVitalsDurationMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatVitalsBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function vitalsHeaderLabel(
  phase: VitalsSyncPhaseModel,
  transport: StreamTransportState | null | undefined,
) {
  if (phase === "idle") return "Not started"
  if (phase === "waiting_camera") return "WebSocket · starting stream…"
  if (phase === "uploading") return "Uploading…"
  if (phase === "recording") {
    if (transport?.rateLimit?.phase === "cooldown") {
      return "API cooldown · frames paused"
    }
    if (transport?.framePhase === "waiting_video") {
      return "Live · preparing camera frames…"
    }
    if (transport?.framePhase === "sampling") {
      return "Live · sending frames to server"
    }
    return "Live stream"
  }
  return "—"
}

function formatVitalsAgo(nowMs: number, ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "—"
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (sec < 1) return "just now"
  if (sec < 60) return `${sec}s ago`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s ago`
}

/** Count down to `endsAt` from `nowMs` as `m:ss` (ceil seconds). */
function formatCountdownUntil(nowMs: number, endsAt: number | null): string {
  if (endsAt == null || !Number.isFinite(endsAt)) return "—"
  const sec = Math.max(0, Math.ceil((endsAt - nowMs) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function nextOutboundSummary(
  nowMs: number,
  phase: VitalsSyncPhaseModel,
  transport: StreamTransportState,
  streamFps: number,
): { value: string; caption: string } {
  if (phase === "waiting_camera") {
    return { value: "—", caption: "After the stream handshakes" }
  }
  if (transport.framePhase === "waiting_video") {
    return { value: "—", caption: "Waiting for camera before sending frames" }
  }
  const rl = transport.rateLimit
  if (!rl) {
    const ms = Math.round(1000 / streamFps)
    return { value: `~${ms} ms`, caption: "Interval between frame payloads" }
  }
  if (rl.phase === "cooldown") {
    return {
      value: formatCountdownUntil(nowMs, rl.cooldownEndsAt),
      caption: "Countdown until frames upload again",
    }
  }
  return {
    value: formatCountdownUntil(nowMs, rl.burstEndsAt),
    caption: "Time left in this send burst",
  }
}

function lastServerPayloadSummary(
  nowMs: number,
  at: number | null,
): { value: string; caption: string } {
  if (at == null || !Number.isFinite(at)) {
    return {
      value: "—",
      caption: "Waiting for vitals or attentiveness from server",
    }
  }
  return {
    value: formatVitalsAgo(nowMs, at),
    caption: "Since last socket payload (vitals or attentiveness)",
  }
}

function VitalsSyncPanel({
  phase,
  error,
  snapshot,
  cameraDisabled = false,
  live,
}: {
  phase: VitalsSyncPhaseModel
  error: string | null
  snapshot:
    | (ProcessSyncParsed & {
        chunkIndex: number
        recordedAt: number
        segmentFps: number
        segmentUploadFps: number
        segmentMimeType: string
        segmentFilename: string
        attentivenessSubRows?: { label: string; value: string }[]
      })
    | null
  /** Camera pipeline off — only the settings placeholder copy. */
  cameraDisabled?: boolean
  live?: {
    nowMs: number
    waitCameraStartedAt: number | null
    recordingStartedAt: number | null
    segmentStartedAt: number | null
    segmentTargetMs: number
    phase: VitalsSyncPhaseModel
    uploads: VitalsUploadLogEntry[]
    transport: StreamTransportState | null
    streamFps: number
  }
}) {
  const payloadTimers =
    live?.transport != null
      ? {
          transport: live.transport,
          outbound: nextOutboundSummary(
            live.nowMs,
            live.phase,
            live.transport,
            live.streamFps,
          ),
          inbound: lastServerPayloadSummary(
            live.nowMs,
            live.transport.lastServerPayloadAt,
          ),
        }
      : null

  if (cameraDisabled) {
    return (
      <div
        className="space-y-2 rounded-lg border border-border bg-muted/25 p-3"
        role="region"
        aria-label="Vitals and attentiveness sync"
      >
        <div className="flex items-center gap-2">
          <Activity
            className="size-3.5 shrink-0 text-muted-foreground opacity-60"
            aria-hidden
          />
          <span className="text-xs font-medium text-foreground">Vitals sync</span>
          <span className="ml-auto truncate text-[10px] text-muted-foreground">
            Unavailable
          </span>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Turn on camera focus detection to stream JPEG frames to the vitals
          server over WebSocket.
        </p>
      </div>
    )
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-muted/25 p-3"
      role="region"
      aria-label="Vitals and attentiveness sync"
    >
      <div className="flex items-center gap-2">
        <Activity
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground",
            phase === "uploading" && "text-blue-600 dark:text-blue-400",
            phase === "recording" && "text-emerald-600 dark:text-emerald-400",
            phase === "waiting_camera" && "text-amber-600 dark:text-amber-400",
          )}
          aria-hidden
        />
        <span className="text-xs font-medium text-foreground">Vitals sync</span>
        <span className="ml-auto max-w-[14rem] truncate text-right text-[10px] text-muted-foreground">
          {vitalsHeaderLabel(phase, live?.transport)}
        </span>
      </div>

      {live &&
      (live.phase !== "idle" ||
        live.uploads.length > 0 ||
        live.waitCameraStartedAt != null) ? (
        <div className="space-y-2 rounded-md border border-border bg-background/60 px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Live status
          </p>
          {payloadTimers ? (
            <div
              className="space-y-3 rounded-md border border-violet-200/70 bg-violet-500/[0.06] px-2.5 py-2.5 dark:border-violet-500/25 dark:bg-violet-500/10"
              role="status"
              aria-live="polite"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                Payload timers
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-medium text-muted-foreground">
                    Next send (out)
                  </p>
                  <p className="font-mono text-base font-semibold tabular-nums leading-none text-foreground">
                    {payloadTimers.outbound.value}
                  </p>
                  <p className="text-[9px] leading-snug text-muted-foreground">
                    {payloadTimers.outbound.caption}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-medium text-muted-foreground">
                    Last received (in)
                  </p>
                  <p className="font-mono text-base font-semibold tabular-nums leading-none text-foreground">
                    {payloadTimers.inbound.value}
                  </p>
                  <p className="text-[9px] leading-snug text-muted-foreground">
                    {payloadTimers.inbound.caption}
                  </p>
                </div>
              </div>
              {payloadTimers.transport.lastVitalsAt != null ||
              payloadTimers.transport.lastAttentivenessAt != null ? (
                <p className="border-t border-violet-200/50 pt-2 text-[9px] leading-snug text-muted-foreground dark:border-violet-500/20">
                  Vitals{" "}
                  <span className="font-mono text-foreground/90">
                    {formatVitalsAgo(
                      live.nowMs,
                      payloadTimers.transport.lastVitalsAt,
                    )}
                  </span>
                  {" · "}
                  Attentiveness{" "}
                  <span className="font-mono text-foreground/90">
                    {formatVitalsAgo(
                      live.nowMs,
                      payloadTimers.transport.lastAttentivenessAt,
                    )}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
          <dl className="space-y-1.5 font-mono text-[10px] leading-snug">
            {live.waitCameraStartedAt != null &&
            live.phase === "waiting_camera" ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Stream starting</dt>
                <dd className="shrink-0 tabular-nums text-foreground">
                  {formatVitalsDurationMs(
                    live.nowMs - live.waitCameraStartedAt,
                  )}
                </dd>
              </div>
            ) : null}
            {live.recordingStartedAt != null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Stream duration</dt>
                <dd className="shrink-0 tabular-nums text-foreground">
                  {formatVitalsDurationMs(
                    live.nowMs - live.recordingStartedAt,
                  )}
                </dd>
              </div>
            ) : null}
            {live.transport ? (
              <>
                {live.transport.sessionId ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Session</dt>
                    <dd
                      className="min-w-0 max-w-[11rem] truncate text-right text-foreground"
                      title={live.transport.sessionId}
                    >
                      {live.transport.sessionId.length > 14
                        ? `${live.transport.sessionId.slice(0, 10)}…`
                        : live.transport.sessionId}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Frame send</dt>
                  <dd className="text-right text-foreground">
                    {live.transport.framePhase === "waiting_video"
                      ? "Preparing JPEGs (waiting for video)…"
                      : `Every ${Math.round(1000 / live.streamFps)} ms · ${live.streamFps} fps`}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Frames sent</dt>
                  <dd className="text-right tabular-nums text-foreground">
                    {live.transport.framesSent}
                    {live.transport.lastFrameSentAt != null
                      ? ` · last ${formatVitalsAgo(live.nowMs, live.transport.lastFrameSentAt)}`
                      : ""}
                  </dd>
                </div>
              </>
            ) : live.segmentStartedAt != null &&
              live.recordingStartedAt != null ? (
              <div className="space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Current segment</dt>
                  <dd className="shrink-0 tabular-nums text-foreground">
                    {formatVitalsDurationMs(
                      live.nowMs - live.segmentStartedAt,
                    )}{" "}
                    /{" "}
                    {formatVitalsDurationMs(live.segmentTargetMs)}
                  </dd>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500/90 transition-[width] duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        ((live.nowMs - live.segmentStartedAt) /
                          live.segmentTargetMs) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div className="flex justify-between gap-2 border-t border-border pt-1.5">
              <dt className="font-sans text-muted-foreground">Send status</dt>
              <dd className="text-right font-sans text-[10px] text-foreground">
                {live.phase === "uploading"
                  ? "Uploading to server…"
                  : live.uploads[0]
                    ? live.uploads[0].ok
                      ? `Last send OK (segment ${live.uploads[0].chunkIndex + 1})`
                      : `Last send failed (segment ${live.uploads[0].chunkIndex + 1})`
                    : live.transport
                      ? "WebSocket stream (no file upload)"
                      : "No uploads yet"}
              </dd>
            </div>
          </dl>

          {live.uploads.length > 0 ? (
            <div className="border-t border-border pt-2">
              <p className="text-[10px] font-medium text-muted-foreground">
                Upload log (newest first)
              </p>
              <ul
                className="mt-1.5 max-h-36 space-y-1.5 overflow-y-auto pr-0.5 font-mono text-[10px] leading-snug"
                aria-label="Vitals upload history"
              >
                {live.uploads.map((u, i) => (
                  <li
                    key={`${u.chunkIndex}-${u.finishedAt}-${i}`}
                    className="rounded border border-border/80 bg-background/50 px-2 py-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "font-semibold",
                          u.ok
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive",
                        )}
                      >
                        {u.ok ? "Success" : "Failed"}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        seg {u.chunkIndex + 1}
                        {typeof u.fps === "number" ? ` · ${u.fps} fps` : ""} ·{" "}
                        {formatVitalsBytes(u.bytes)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {new Date(u.finishedAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      {u.filename || u.mimeType ? (
                        <span className="mt-0.5 block break-all font-mono text-[9px] text-foreground/90">
                          {u.filename}
                          {u.filename && u.mimeType ? " · " : null}
                          {u.mimeType}
                        </span>
                      ) : null}
                      {u.errorMessage ? (
                        <span className="mt-0.5 block text-destructive">
                          {u.errorMessage}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="py-2">
          <AlertTitle className="text-xs">Sync issue</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {snapshot ? (
        <div className="space-y-2 rounded-md border border-border bg-background/80 px-2.5 py-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            {snapshot.segmentMimeType === "stream"
              ? `Live update #${snapshot.chunkIndex}`
              : `Segment ${snapshot.chunkIndex + 1}`}
            <span className="tabular-nums text-muted-foreground/80">
              {" "}
              ·{" "}
              {new Date(snapshot.recordedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </p>
          <dl className="space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">File name</dt>
              <dd className="min-w-0 break-all text-right font-mono text-[10px] text-foreground">
                {snapshot.segmentFilename}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">MIME type</dt>
              <dd className="min-w-0 break-all text-right font-mono text-[10px] text-foreground">
                {snapshot.segmentMimeType}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Camera FPS</dt>
              <dd className="min-w-0 text-right font-mono text-[10px] tabular-nums text-foreground">
                {snapshot.segmentFps}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Fps (multipart)</dt>
              <dd className="min-w-0 text-right font-mono text-[10px] tabular-nums text-foreground">
                {snapshot.segmentUploadFps}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Attentiveness</dt>
              <dd className="min-w-0 text-right font-medium tabular-nums text-foreground">
                {snapshot.attentiveness ?? "—"}
              </dd>
            </div>
            {snapshot.attentivenessSubRows &&
            snapshot.attentivenessSubRows.length > 0 ? (
              <div className="space-y-1 border-t border-border pt-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Attentiveness detail
                </div>
                {snapshot.attentivenessSubRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0 break-all text-right font-mono text-[10px] text-foreground">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </div>
            ) : null}
            {snapshot.vitalsRows.length ? (
              <>
                <div className="border-t border-border pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Vitals
                </div>
                {snapshot.vitalsRows.map((row) => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0 break-all text-right font-mono text-[10px] text-foreground">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                No vitals fields in the last response — check server JSON shape.
              </p>
            )}
          </dl>
        </div>
      ) : (
        !error && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            {phase === "idle"
              ? "Start a session from the main panel. Vitals sync runs over WebSocket while your session is active."
              : "The server pushes vitals and attentiveness when it is ready. Keep your face in frame for best results."}
          </p>
        )
      )}
    </div>
  )
}

function FocusDebugSnapshotPanel({
  snap,
}: {
  snap: FocusDebugSnapshot | null
}) {
  if (!snap) {
    return (
      <p className="rounded-md border border-dashed border-border bg-background/50 px-3 py-6 text-center text-xs text-muted-foreground">
        Waiting for the camera pipeline… Grant camera access if prompted.
      </p>
    )
  }

  const rows: Array<{ label: string; value: unknown }> = [
    { label: "Phase", value: snap.phase },
    { label: "Status", value: snap.status },
    { label: "Activity mode", value: snap.activityMode },
    { label: "Face seen once", value: snap.faceSeenOnce },
    { label: "Detections", value: snap.detections },
    { label: "Widget focused", value: snap.widgetIsFocused },
    { label: "Distracted", value: snap.distracted },
    { label: "Reason", value: snap.reason },
    { label: "Note", value: snap.note },
    { label: "Video time (ms)", value: snap.videoTimeMs },
    { label: "Video currentTime", value: snap.videoCurrentTime },
    { label: "Canvas (w×h)", value: `${snap.canvas.width} × ${snap.canvas.height}` },
    {
      label: "Video display (w×h)",
      value: `${snap.videoDisplay.width} × ${snap.videoDisplay.height}`,
    },
    { label: "Detection score", value: snap.detectionScore },
    { label: "eyeBalance", value: snap.eyeBalance },
    { label: "noseFaceRatioX", value: snap.noseFaceRatioX },
    { label: "eyeTilt", value: snap.eyeTilt },
    { label: "faceWidthRatio", value: snap.faceWidthRatio },
    { label: "lookDownRatio", value: snap.lookDownRatio },
    { label: "lookUpMargin", value: snap.lookUpMargin },
    { label: "Looking down", value: snap.lookingDown },
    { label: "Looking up", value: snap.lookingUp },
    { label: "Face too small", value: snap.faceTooSmall },
    { label: "Pose away from screen", value: snap.poseAwayFromScreen },
    { label: "Face box", value: snap.box },
    { label: "Thresholds", value: snap.thresholds },
  ]

  return (
    <div className="max-h-[min(20rem,45vh)] overflow-auto rounded-md border border-border bg-background/80">
      <dl className="divide-y divide-border font-mono text-[10px] leading-snug">
        {rows.map(({ label, value }) => {
          if (value === undefined) return null
          return (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 px-2.5 py-1.5 sm:grid-cols-[11rem_1fr]"
            >
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all text-foreground">
                {formatDebugValue(value)}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

// Export types for external usage
export type { FocusState, LeaderboardEntry }
