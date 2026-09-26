import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"

export interface ToolbarProps {
  title: string
  /** History buttons like System Settings. Omit a handler to disable that button. */
  onBack?: () => void
  onForward?: () => void
  showHistory?: boolean
  /** Controls on the right (search field, buttons). */
  actions?: ReactNode
}

/** The content column's title bar. It doubles as the window's drag region. */
export function Toolbar({ title, onBack, onForward, showHistory = false, actions }: ToolbarProps) {
  return (
    <header className="nx-toolbar" data-tauri-drag-region>
      {showHistory && (
        <div className="nx-toolbar__history">
          <button
            type="button"
            className="nx-icon-button"
            aria-label="Back"
            disabled={!onBack}
            onClick={onBack}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="nx-icon-button"
            aria-label="Forward"
            disabled={!onForward}
            onClick={onForward}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      <h1 className="nx-toolbar__title" data-tauri-drag-region>
        {title}
      </h1>
      <div className="nx-toolbar__actions">{actions}</div>
    </header>
  )
}
