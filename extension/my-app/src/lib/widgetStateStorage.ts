import type { FocusState } from "@/components/widget/FocusState"
import type { ActivityMode } from "@/components/widget/ActivityModeRow"

export const WIDGET_STATE_STORAGE_KEY = "lockin-widget-state-v1"

/** Legacy key — kept in sync when persisting so older paths still see elapsed time. */
export const SESSION_ELAPSED_STORAGE_KEY = "lockin-session-elapsed-seconds"

export type PersistedWidgetStateV1 = {
  v: 1
  focusState: FocusState
  sessionGoalMinutes: number
  sessionElapsedSeconds: number
  graceRemaining: number
  activityMode: ActivityMode
  minimized: boolean
  ttsEnabled: boolean
  settingsOpen: boolean
}

const FOCUS_STATES = new Set<FocusState>([
  "getting_started",
  "focused",
  "warning",
  "distracted",
  "away",
  "calibrating",
])

const ACTIVITY_MODES = new Set<ActivityMode>(["lecture", "video", "notes"])

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function parsePersistedWidgetStateJson(
  raw: string,
): Partial<PersistedWidgetStateV1> | null {
  return parsePersisted(raw)
}

function parsePersisted(raw: string): Partial<PersistedWidgetStateV1> | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (o?.v !== 1) return null
    const out: Partial<PersistedWidgetStateV1> = {}

    if (typeof o.focusState === "string" && FOCUS_STATES.has(o.focusState as FocusState)) {
      out.focusState = o.focusState as FocusState
    }
    if (typeof o.sessionGoalMinutes === "number" && Number.isFinite(o.sessionGoalMinutes)) {
      out.sessionGoalMinutes = clamp(Math.round(o.sessionGoalMinutes), 5, 240)
    }
    if (typeof o.sessionElapsedSeconds === "number" && Number.isFinite(o.sessionElapsedSeconds)) {
      out.sessionElapsedSeconds = Math.max(0, Math.floor(o.sessionElapsedSeconds))
    }
    if (typeof o.graceRemaining === "number" && Number.isFinite(o.graceRemaining)) {
      out.graceRemaining = Math.max(0, Math.floor(o.graceRemaining))
    }
    if (typeof o.activityMode === "string" && ACTIVITY_MODES.has(o.activityMode as ActivityMode)) {
      out.activityMode = o.activityMode as ActivityMode
    }
    if (typeof o.minimized === "boolean") out.minimized = o.minimized
    if (typeof o.ttsEnabled === "boolean") out.ttsEnabled = o.ttsEnabled
    if (typeof o.settingsOpen === "boolean") out.settingsOpen = o.settingsOpen

    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

export function readPersistedWidgetState(): Partial<PersistedWidgetStateV1> | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(WIDGET_STATE_STORAGE_KEY)
    if (!raw) return null
    return parsePersisted(raw)
  } catch {
    return null
  }
}

export function writePersistedWidgetState(state: PersistedWidgetStateV1) {
  try {
    localStorage.setItem(WIDGET_STATE_STORAGE_KEY, JSON.stringify(state))
    localStorage.setItem(
      SESSION_ELAPSED_STORAGE_KEY,
      String(state.sessionElapsedSeconds),
    )
  } catch {
    /* quota / private mode */
  }
}

export function readLegacySessionElapsedOnly(): number | null {
  try {
    const v = localStorage.getItem(SESSION_ELAPSED_STORAGE_KEY)
    if (v === null) return null
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n) && n >= 0) return n
  } catch {
    /* ignore */
  }
  return null
}

export type HydratedWidgetState = {
  focusState: FocusState
  sessionGoalMinutes: number
  sessionElapsedSeconds: number
  graceRemaining: number
  activityMode: ActivityMode
  minimized: boolean
  ttsEnabled: boolean
  settingsOpen: boolean
}

/** First mount: restore from `lockin-widget-state-v1`, else legacy elapsed key, else props. */
export function hydrateWidgetState(options: {
  initialFocusState: FocusState
  focusDuration: number
  sessionGoal: number
  graceTotal: number
  /** Skip localStorage (e.g. toolbar reopen after closing session — start at getting_started). */
  ignorePersisted?: boolean
}): HydratedWidgetState {
  const safeGrace = Math.max(1, options.graceTotal)

  if (options.ignorePersisted) {
    return {
      focusState: "getting_started",
      sessionGoalMinutes: options.sessionGoal,
      sessionElapsedSeconds: 0,
      graceRemaining: safeGrace,
      activityMode: "lecture",
      minimized: false,
      ttsEnabled: true,
      settingsOpen: false,
    }
  }

  const p = readPersistedWidgetState()

  let focusState = options.initialFocusState
  let sessionGoalMinutes = options.sessionGoal
  let sessionElapsedSeconds = 0
  let graceRemaining = safeGrace
  let activityMode: ActivityMode = "lecture"
  let minimized = false
  let ttsEnabled = true
  let settingsOpen = false

  if (p) {
    if (p.focusState !== undefined) focusState = p.focusState
    if (p.sessionGoalMinutes !== undefined) sessionGoalMinutes = p.sessionGoalMinutes
    if (p.sessionElapsedSeconds !== undefined) sessionElapsedSeconds = p.sessionElapsedSeconds
    if (p.graceRemaining !== undefined) graceRemaining = p.graceRemaining
    if (p.activityMode !== undefined) activityMode = p.activityMode
    if (p.minimized !== undefined) minimized = p.minimized
    if (p.ttsEnabled !== undefined) ttsEnabled = p.ttsEnabled
    if (p.settingsOpen !== undefined) settingsOpen = p.settingsOpen
  } else if (options.initialFocusState !== "getting_started") {
    const legacy = readLegacySessionElapsedOnly()
    if (legacy !== null) sessionElapsedSeconds = legacy
    else sessionElapsedSeconds = Math.max(0, Math.round(options.focusDuration * 60))
  }

  if (focusState === "getting_started") {
    sessionElapsedSeconds = 0
  }

  if (focusState === "warning" && graceRemaining < 1) {
    graceRemaining = safeGrace
  }

  return {
    focusState,
    sessionGoalMinutes,
    sessionElapsedSeconds,
    graceRemaining,
    activityMode,
    minimized,
    ttsEnabled,
    settingsOpen,
  }
}
