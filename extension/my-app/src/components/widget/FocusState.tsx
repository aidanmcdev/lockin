"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Badge, badgeVariants } from "@/components/ui/badge"
import {
  Eye,
  EyeOff,
  Activity,
  Clock,
  AlertTriangle,
  Sparkles,
  Minus,
  Plus,
} from "lucide-react"

export type FocusState =
  | "getting_started"
  | "focused"
  | "warning"
  | "distracted"
  | "away"
  | "calibrating"

interface FocusStatusProps {
  status: FocusState
  /** Elapsed focus session time in seconds (updates while focused; frozen in warning / after distracted). */
  sessionElapsedSeconds?: number
  /** Session goal in minutes while {@link status} is `getting_started`. */
  sessionGoalMinutes?: number
  /** Change goal by delta minutes (e.g. ±5) in getting started. */
  onAdjustSessionGoal?: (deltaMinutes: number) => void
  /** Tap the time badge to leave setup and start calibrating / focus. */
  onStartSessionFromSetup?: () => void
  /** Hover replaces the timer with an End session control; click ends the session. */
  onEndSession?: () => void
  className?: string
}

const statusConfig: Record<
  FocusState,
  { label: string; icon: typeof Eye; colorClass: string; bgClass: string }
> = {
  getting_started: {
    label: "Getting started",
    icon: Sparkles,
    colorClass: "text-violet-600 dark:text-violet-400",
    bgClass: "bg-violet-500/15 border-violet-500/30",
  },
  focused: {
    label: "Focused",
    icon: Eye,
    colorClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-500/15 border-emerald-500/30",
  },
  warning: {
    label: "Refocus",
    icon: AlertTriangle,
    colorClass: "text-yellow-600 dark:text-yellow-400",
    bgClass: "bg-yellow-500/15 border-yellow-500/30",
  },
  distracted: {
    label: "Distracted",
    icon: EyeOff,
    colorClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-500/15 border-amber-500/30",
  },
  away: {
    label: "Away",
    icon: EyeOff,
    colorClass: "text-muted-foreground",
    bgClass: "bg-muted border-border",
  },
  calibrating: {
    label: "Calibrating",
    icon: Activity,
    colorClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-500/15 border-blue-500/30",
  },
}

/** Whole minutes shown as `mm:00` for the setup picker. */
function formatGoalMinutesAsClock(minutes: number) {
  const m = Math.max(1, Math.min(240, Math.round(minutes)))
  return `${m}:00`
}

function formatSessionClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
  }
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function FocusStatus({
  status,
  sessionElapsedSeconds = 0,
  sessionGoalMinutes = 25,
  onAdjustSessionGoal,
  onStartSessionFromSetup,
  onEndSession,
  className,
}: FocusStatusProps) {
  const config = statusConfig[status]
  const Icon = config.icon
  const [tick, setTick] = useState(false)

  const isWarning = status === "warning"
  const isGettingStarted = status === "getting_started"
  /** Session clock runs (ticks) only while focused or in warning; stops after distracted. */
  const clockRunning = status === "focused" || isWarning

  useEffect(() => {
    if (!clockRunning) return
    const interval = setInterval(() => {
      setTick((prev) => !prev)
    }, 1000)
    return () => clearInterval(interval)
  }, [clockRunning])

  return (
    <div className={cn("flex items-center justify-between", className)}>
      {/* Focus State Badge */}
      {isGettingStarted && onStartSessionFromSetup ? (
        <button
          type="button"
          onClick={onStartSessionFromSetup}
          title="Start session"
          aria-label="Start session"
          className={cn(
            badgeVariants({ variant: "outline" }),
            "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-all duration-300",
            config.bgClass,
            config.colorClass,
            "cursor-pointer hover:bg-violet-500/25 hover:text-violet-900 dark:hover:bg-violet-500/20 dark:hover:text-violet-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <Icon className="size-3.5 transition-transform duration-300" />
          <span>{config.label}</span>
        </button>
      ) : (
        <Badge
          variant="outline"
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-all duration-300",
            config.bgClass,
            config.colorClass,
          )}
        >
          <Icon className="size-3.5 transition-transform duration-300" />
          <span>{config.label}</span>
        </Badge>
      )}

      {/* Session clock: blue in calibrating; yellow in warning; amber when distracted; muted when away. */}
      {(() => {
        const sessionClockClassName = cn(
          "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-all duration-300",
          isGettingStarted &&
            "bg-violet-500/15 border-violet-500/30 text-violet-700 dark:text-violet-300",
          status === "focused" &&
            "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
          status === "calibrating" &&
            "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400",
          isWarning &&
            "bg-yellow-500/15 border-yellow-500/30 text-yellow-600 dark:text-yellow-400",
          status === "distracted" &&
            "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400",
          !clockRunning &&
            status !== "distracted" &&
            status !== "calibrating" &&
            !isGettingStarted &&
            "bg-muted border-border text-muted-foreground",
        )

        const gettingStartedHoverClass =
          "transition-colors hover:bg-violet-500/25 hover:text-violet-900 dark:hover:bg-violet-500/20 dark:hover:text-violet-100"

        const gettingStartedControlClass =
          `flex size-6 shrink-0 items-center justify-center rounded-md border border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300 ${gettingStartedHoverClass}`

        if (isGettingStarted && onAdjustSessionGoal && onStartSessionFromSetup) {
          return (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className={gettingStartedControlClass}
                aria-label="Decrease session length"
                onClick={() => onAdjustSessionGoal(-5)}
              >
                <Minus className="size-3" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={onStartSessionFromSetup}
                title="Start session"
                aria-label={`Start ${sessionGoalMinutes} minute session`}
                className={cn(
                  badgeVariants({ variant: "outline" }),
                  sessionClockClassName,
                  "min-w-[3.75rem] cursor-pointer px-2 py-1",
                  gettingStartedHoverClass,
                )}
              >
                <Clock className="size-3 shrink-0 opacity-80" />
                <span className="font-mono text-[11px] tabular-nums leading-none">
                  {formatGoalMinutesAsClock(sessionGoalMinutes)}
                </span>
              </button>
              <button
                type="button"
                className={gettingStartedControlClass}
                aria-label="Increase session length"
                onClick={() => onAdjustSessionGoal(5)}
              >
                <Plus className="size-3" strokeWidth={2.5} />
              </button>
            </div>
          )
        }

        const timerBadge = (
          <Badge variant="outline" className={sessionClockClassName}>
            <Clock
              className={cn(
                "size-3.5 transition-transform duration-150",
                clockRunning && tick && "scale-110",
              )}
            />
            <span
              className={cn(
                "font-mono tabular-nums transition-all duration-150",
                clockRunning && tick && "opacity-80",
              )}
            >
              {formatSessionClock(sessionElapsedSeconds)}
            </span>
          </Badge>
        )

        if (!onEndSession) {
          return timerBadge
        }

        return (
          <div className="group relative flex justify-end">
            <div className="grid grid-cols-1 grid-rows-1 place-items-end">
              <div
                className={cn(
                  "col-start-1 row-start-1 opacity-100 transition-opacity duration-150 group-hover:opacity-0",
                  "pointer-events-auto group-hover:pointer-events-none",
                )}
              >
                {timerBadge}
              </div>
              <button
                type="button"
                onClick={onEndSession}
                title="End session"
                aria-label="End session"
                className={cn(
                  badgeVariants({ variant: "outline" }),
                  "col-start-1 row-start-1 pointer-events-none opacity-0 transition-opacity duration-150",
                  "group-hover:pointer-events-auto group-hover:opacity-100",
                  "cursor-pointer border-destructive/45 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive shadow-sm",
                  "hover:bg-destructive/15 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  // Dark theme contrast: make the destructive chip more visible on neutral-800 panel.
                  // In dark mode we want hover to get *darker* (less red fill) instead of lighter.
                  "dark:border-destructive/60 dark:bg-destructive/35 dark:hover:bg-destructive/25 dark:text-destructive-foreground dark:hover:border-destructive/70",
                )}
              >
                End session
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
