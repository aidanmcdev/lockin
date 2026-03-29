"use client"

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
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
import { Maximize2, Mic, MicOff, Minimize2, Settings, X } from "lucide-react"
import {
  getFocusDebugSnapshot,
  getFocusDetectionCanvas,
  speakFocusNudge,
  startFocusDetection,
  STEADY_DISTRACTED_NUDGE_MS,
  type FocusDebugSnapshot,
} from "@/focusDetection"
import {
  hydrateWidgetState,
  parsePersistedWidgetStateJson,
  readLegacySessionElapsedOnly,
  SESSION_ELAPSED_STORAGE_KEY,
  WIDGET_STATE_STORAGE_KEY,
  writePersistedWidgetState,
} from "@/lib/widgetStateStorage"

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

  // Styling
  className?: string
}

// Placeholder data for demonstration
const defaultLeaderboardEntries: LeaderboardEntry[] = [
  { id: "1", name: "Sarah Chen", focusTime: 245, rank: 1, previousRank: 2, avatarUrl: "" },
  { id: "2", name: "Alex Kim", focusTime: 230, rank: 2, previousRank: 1, avatarUrl: "" },
  { id: "3", name: "Jordan Lee", focusTime: 218, rank: 3, previousRank: 3, avatarUrl: "" },
  { id: "current", name: "You", focusTime: 187, rank: 4, previousRank: 5, isCurrentUser: true, avatarUrl: "" },
  { id: "5", name: "Taylor Smith", focusTime: 165, rank: 5, previousRank: 4, avatarUrl: "" },
]

/** Posted to `window.parent` so the content-script iframe can size to this panel (fixed layout is invisible to parent `scrollHeight`). */
const IFRAME_SIZE_MSG = {
  source: "lockin-extension-panel",
  type: "SIZE",
} as const

export function FocusWidget({
  initialFocusState = "getting_started",
  focusDuration = 42,
  sessionGoal = 60,
  graceTotal = 10,
  leaderboardEntries = defaultLeaderboardEntries,
  currentUserRank = 4,
  totalParticipants = 12,
  position = "bottom-right",
  onClose,
  onSettings,
  enableCameraFocusDetection = true,
  freshSession = false,
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

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return

    const postSize = () => {
      const r = el.getBoundingClientRect()
      window.parent.postMessage(
        {
          ...IFRAME_SIZE_MSG,
          width: Math.ceil(r.width),
          height: Math.ceil(r.height),
        },
        "*",
      )
    }

    postSize()
    const ro = new ResizeObserver(() => postSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [settingsOpen, minimized, position])

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


  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => {
      onClose?.()
    }, 200)
  }, [onClose])

  const handleEndSession = useCallback(() => {
    setSessionElapsedSeconds(0)
    handleClose()
  }, [handleClose])

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
          "overflow-hidden border shadow-lg",
          settingsOpen
            ? "w-[min(28rem,calc(100vw-1.25rem))] max-w-[96vw]"
            : "w-72",
          "bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
        )}
      >
        {/* Header — title left; TTS, minimize, settings, close on the right */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold tracking-tight">Lock-In.tech</span>
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
                onClick={handleClose}
              >
                <X className="size-3.5" />
                <span className="sr-only">Close widget</span>
              </Button>
            )}
          </div>
        </div>

        {settingsOpen ? (
          <div
            className="min-h-[min(22rem,calc(100vh-6rem))] border-b border-border bg-muted/30 p-5"
            role="region"
            aria-label="Settings"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
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

                <Leaderboard
                  entries={leaderboardEntries}
                  currentUserRank={currentUserRank}
                  totalParticipants={totalParticipants}
                />
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
