/**
 * Grouped, inset lists like System Settings: a {@link Group} is a rounded card of
 * {@link Row}s separated by hairlines, with an optional heading and footnote.
 */
import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cx } from "./cx"

export function Page({ children }: { children: ReactNode }) {
  return <div className="nx-page">{children}</div>
}

export interface GroupProps {
  title?: ReactNode
  /** Controls on the heading's right, e.g. a "Scan" button. */
  titleAccessory?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function Group({ title, titleAccessory, footer, children }: GroupProps) {
  return (
    <section className="nx-group">
      {(title || titleAccessory) && (
        <div className="nx-group__heading">
          {title && <h2 className="nx-group__title">{title}</h2>}
          {titleAccessory && <div className="nx-group__accessory">{titleAccessory}</div>}
        </div>
      )}
      <div className="nx-group__card">{children}</div>
      {footer && <p className="nx-group__footer">{footer}</p>}
    </section>
  )
}

export interface RowProps {
  label: ReactNode
  /** Secondary text under the label. */
  description?: ReactNode
  /** Icon tile or image on the left. */
  icon?: ReactNode
  /** The control or value on the right. */
  children?: ReactNode
  /** Makes the whole row a button with a chevron (drill-in). */
  onClick?: () => void
  /** Stack the control under the label (wide sliders, pickers). */
  stacked?: boolean
  htmlFor?: string
  className?: string
}

export function Row({
  label,
  description,
  icon,
  children,
  onClick,
  stacked,
  htmlFor,
  className,
}: RowProps) {
  const body = (
    <>
      {icon && <span className="nx-row__icon">{icon}</span>}
      <span className="nx-row__text">
        {htmlFor ? (
          <label className="nx-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="nx-row__label">{label}</span>
        )}
        {description && <span className="nx-row__description">{description}</span>}
      </span>
      {children !== undefined && <span className="nx-row__control">{children}</span>}
      {onClick && <ChevronRight className="nx-row__chevron" size={14} aria-hidden="true" />}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={cx("nx-row", "nx-row--button", className)} onClick={onClick}>
        {body}
      </button>
    )
  }
  return <div className={cx("nx-row", stacked && "nx-row--stacked", className)}>{body}</div>
}

/** A read-only value on the right of a row. */
export function Value({ children }: { children: ReactNode }) {
  return <span className="nx-value">{children}</span>
}

/** A colored rounded-square tile with a white glyph, like System Settings' icons. */
export function IconTile({
  color,
  children,
  size = 24,
}: {
  color: string
  children: ReactNode
  size?: number
}) {
  return (
    <span className="nx-icon-tile" style={{ background: color, width: size, height: size }}>
      {children}
    </span>
  )
}

/** A notice inside a page: an error, a warning, or a tip. */
export function Callout({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warning" | "danger"
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      className={cx("nx-callout", `nx-callout--${tone}`)}
      role={tone === "danger" ? "alert" : "note"}
    >
      <div className="nx-callout__body">{children}</div>
      {action && <div className="nx-callout__action">{action}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="nx-empty">
      {icon && <div className="nx-empty__icon">{icon}</div>}
      <div className="nx-empty__title">{title}</div>
      {children && <div className="nx-empty__body">{children}</div>}
    </div>
  )
}
