import { Callout, Spinner } from "@helixos/ui"
import type { ReactNode } from "react"

/** Shown when a backend call failed, with a retry. */
export function LoadError({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <Callout
      tone="danger"
      action={
        retry && (
          <button type="button" className="nx-button nx-button--small" onClick={retry}>
            Try Again
          </button>
        )
      }
    >
      {error}
    </Callout>
  )
}

/** An inline error under an action (a failed toggle, a wrong password). */
export function ActionError({ error }: { error: string | null }) {
  if (!error) return null
  return <Callout tone="danger">{error}</Callout>
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div className="settings-loading">
      <Spinner /> {children}
    </div>
  )
}

/** Wi-Fi strength as 1-3 arcs. */
export function SignalIcon({ bars }: { bars: 1 | 2 | 3 }) {
  return (
    <svg
      className="settings-signal"
      viewBox="0 0 20 16"
      aria-label={`Signal ${bars} of 3`}
      role="img"
    >
      <path d="M10 14.5 l2.1-2.4a3.2 3.2 0 0 0-4.2 0z" className="on" />
      <path
        d="M5.2 9.6a7 7 0 0 1 9.6 0l-1.6 1.8a4.6 4.6 0 0 0-6.4 0z"
        className={bars >= 2 ? "on" : ""}
      />
      <path
        d="M2 6.1a11.6 11.6 0 0 1 16 0l-1.6 1.8a9.2 9.2 0 0 0-12.8 0z"
        className={bars >= 3 ? "on" : ""}
      />
    </svg>
  )
}
