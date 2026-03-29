/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override TTS base (e.g. `http://127.0.0.1:3000`); `/tts` is appended if missing. */
  readonly VITE_TTS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    /** Set by FocusWidget — `true` when user is facing the task (camera), `false` when looking away. */
    setFocusState?: (isFocused: boolean) => void
    /** Set by FocusWidget — activity mode for focus-detection rules (lecture / video / notes). */
    getActivityMode?: () => "lecture" | "video" | "notes"
    /** Set by FocusWidget — `false` skips ElevenLabs voice nudges. */
    getTtsEnabled?: () => boolean
  }
}

export {}
