import type { ReactNode } from "react"
import { cx } from "./cx"

export function Sidebar({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <nav className="nx-sidebar">
      {header && <div className="nx-sidebar__header">{header}</div>}
      <div className="nx-sidebar__scroll">{children}</div>
    </nav>
  )
}

export function SidebarSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="nx-sidebar__section" role="group" aria-label={title}>
      {title && <div className="nx-sidebar__section-title">{title}</div>}
      {children}
    </div>
  )
}

export interface SidebarItemProps {
  label: string
  icon?: ReactNode
  selected?: boolean
  /** Small text on the right, e.g. the connected network. */
  detail?: string
  onSelect?: () => void
}

export function SidebarItem({ label, icon, selected, detail, onSelect }: SidebarItemProps) {
  return (
    <button
      type="button"
      className={cx("nx-sidebar__item", selected && "nx-sidebar__item--selected")}
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
    >
      {icon && <span className="nx-sidebar__icon">{icon}</span>}
      <span className="nx-sidebar__label">{label}</span>
      {detail && <span className="nx-sidebar__detail">{detail}</span>}
    </button>
  )
}
