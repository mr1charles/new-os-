/**
 * Sheets (modal dialogs that slide down from the toolbar) and popovers, both on the native
 * <dialog> element so focus trapping, Escape, and the top layer come from the browser.
 */
import { useEffect, useRef, type ReactNode } from "react"
import { cx } from "./cx"

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Buttons at the bottom right, primary last. */
  actions?: ReactNode
  width?: number
}

export function Sheet({ open, onClose, title, children, actions, width = 420 }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // jsdom has no showModal; fall back to the open attribute so tests still render it.
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal()
      else dialog.setAttribute("open", "")
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close()
      else dialog.removeAttribute("open")
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className="nx-sheet"
      style={{ width }}
      aria-label={typeof title === "string" ? title : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onClose()
        }
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="nx-sheet__inner">
          {title && <h2 className="nx-sheet__title">{title}</h2>}
          <div className="nx-sheet__body">{children}</div>
          {actions && <div className="nx-sheet__actions">{actions}</div>}
        </div>
      )}
    </dialog>
  )
}

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The element the popover points at. */
  anchor: ReactNode
  children: ReactNode
  align?: "start" | "end"
}

/** A small panel under its anchor. Closes on Escape and on clicks outside it. */
export function Popover({ open, onClose, anchor, children, align = "start" }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  return (
    <div className="nx-popover-anchor" ref={ref}>
      {anchor}
      {open && (
        <div className={cx("nx-popover", `nx-popover--${align}`)} role="dialog">
          {children}
        </div>
      )}
    </div>
  )
}
