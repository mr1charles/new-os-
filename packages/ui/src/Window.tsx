/**
 * Window chrome. HelixOS apps run without server-side decorations: the traffic lights, drag
 * region, and sidebar vibrancy are drawn here, and Hyprland supplies rounding, shadow, and
 * the blur behind the translucent sidebar.
 */
import { inTauri } from "@helixos/sdk"
import type { CSSProperties, ReactNode } from "react"
import { cx } from "./cx"

type WindowAction = "close" | "minimize" | "zoom"

async function windowAction(action: WindowAction) {
  if (!inTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const win = getCurrentWindow()
  if (action === "close") await win.close()
  else if (action === "minimize") await win.minimize()
  else await win.toggleMaximize()
}

export function TrafficLights({ inactive = false }: { inactive?: boolean }) {
  return (
    <div className={cx("nx-traffic", inactive && "nx-traffic--inactive")}>
      <button
        type="button"
        className="nx-traffic__btn nx-traffic__close"
        aria-label="Close"
        onClick={() => void windowAction("close")}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
        </svg>
      </button>
      <button
        type="button"
        className="nx-traffic__btn nx-traffic__minimize"
        aria-label="Minimize"
        onClick={() => void windowAction("minimize")}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 6h6" />
        </svg>
      </button>
      <button
        type="button"
        className="nx-traffic__btn nx-traffic__zoom"
        aria-label="Zoom"
        onClick={() => void windowAction("zoom")}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.5 5V3.5H5M8.5 7v1.5H7" />
        </svg>
      </button>
    </div>
  )
}

/**
 * Minimize, maximize, and close on the right, like Windows. Shown instead of the traffic
 * lights when Settings → Windows → Buttons is "Windows" (`data-controls` on the root).
 */
export function WindowControls() {
  return (
    <div className="nx-wincontrols">
      <button
        type="button"
        className="nx-wincontrols__btn"
        aria-label="Minimize"
        onClick={() => void windowAction("minimize")}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" />
        </svg>
      </button>
      <button
        type="button"
        className="nx-wincontrols__btn"
        aria-label="Maximize"
        onClick={() => void windowAction("zoom")}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        className="nx-wincontrols__btn nx-wincontrols__close"
        aria-label="Close"
        onClick={() => void windowAction("close")}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  )
}

export interface WindowProps {
  /** Left column (usually a {@link Sidebar}). Omit for a single-pane window. */
  sidebar?: ReactNode
  /** Width of the sidebar column in px. */
  sidebarWidth?: number
  children: ReactNode
  className?: string
}

/** A full-window layout: sidebar with traffic lights, and a content column. */
export function Window({ sidebar, sidebarWidth = 240, children, className }: WindowProps) {
  return (
    <div
      className={cx("nx-window", !sidebar && "nx-window--single", className)}
      style={{ "--nx-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      {sidebar ? (
        <aside className="nx-window__sidebar">
          <div className="nx-window__sidebar-top" data-tauri-drag-region>
            <TrafficLights />
          </div>
          {sidebar}
        </aside>
      ) : (
        <div className="nx-window__floating-traffic">
          <TrafficLights />
        </div>
      )}
      <main className="nx-window__content">{children}</main>
      <WindowControls />
    </div>
  )
}
