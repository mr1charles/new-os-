/** Buttons, switches, sliders, and fields in the macOS style, built on native elements. */
import { Search, X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type CSSProperties,
  type SelectHTMLAttributes,
} from "react"
import { cx } from "./cx"

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> {
  variant?: "default" | "primary" | "destructive" | "plain"
  size?: "regular" | "small"
  /** Shows a spinner, sets aria-busy and swallows clicks, keeping keyboard focus on the button. */
  loading?: boolean
}

const PRESS_SPRING = { type: "spring", stiffness: 600, damping: 32 } as const
const WIDTH_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const

/** Springs the label's width to fit its content, so "Save" to "Saved" does not jump. */
function MorphLabel({ children, reduce }: { children: string | number; reduce: boolean }) {
  const measure = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = measure.current
    if (!el) return
    setWidth(el.offsetWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setWidth(el.offsetWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.span
      className="nx-button__morph"
      initial={false}
      animate={width === undefined ? undefined : { width }}
      transition={reduce ? { duration: 0 } : WIDTH_SPRING}
    >
      <span ref={measure} className="nx-button__measure">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={String(children)}
            className="nx-button__label"
            initial={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(3px)", scale: 0.96 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(3px)", scale: 0.96 }}
            transition={{ duration: 0.16 }}
          >
            {children}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  )
}

export function Button({
  variant = "default",
  size = "regular",
  loading = false,
  className,
  type = "button",
  children,
  onClick,
  disabled,
  ...props
}: ButtonProps) {
  const reduce = useReducedMotion() ?? false
  const label = typeof children === "string" || typeof children === "number" ? children : null
  return (
    <motion.button
      type={type}
      className={cx(
        "nx-button",
        `nx-button--${variant}`,
        size === "small" && "nx-button--small",
        loading && "nx-button--loading",
        className,
      )}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      whileTap={reduce || disabled || loading ? undefined : { scale: 0.97 }}
      transition={PRESS_SPRING}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading && <span className="nx-button__spinner" aria-hidden="true" />}
      {label !== null ? <MorphLabel reduce={reduce}>{label}</MorphLabel> : children}
    </motion.button>
  )
}

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Accessible name when there is no visible label next to it. */
  label?: string
  id?: string
}

/** An on/off switch (role="switch"). Space and Enter toggle it. */
export function Toggle({ checked, onChange, disabled, label, id }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("nx-toggle", checked && "nx-toggle--on")}
      onClick={() => onChange(!checked)}
    >
      <span className="nx-toggle__knob" />
    </button>
  )
}

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  /** Fires once when the user lets go, for changes that should not run on every step. */
  onCommit?: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  label?: string
  /** Icons or captions at either end ("Slow" … "Fast"). */
  start?: ReactNode
  end?: ReactNode
  /** Snap marks shown under the track. */
  ticks?: number
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  label,
  start,
  end,
  ticks,
}: SliderProps) {
  const fraction = max > min ? (value - min) / (max - min) : 0
  const commit = (e: { currentTarget: HTMLInputElement }) =>
    onCommit?.(Number(e.currentTarget.value))
  return (
    <div className={cx("nx-slider", disabled && "nx-slider--disabled")}>
      {start && <span className="nx-slider__end">{start}</span>}
      <div className="nx-slider__track-wrap">
        <input
          type="range"
          className="nx-slider__input"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={
            {
              "--nx-fill": `${Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10}%`,
            } as CSSProperties
          }
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        {ticks && ticks > 1 && (
          <div className="nx-slider__ticks" aria-hidden="true">
            {Array.from({ length: ticks }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        )}
      </div>
      {end && <span className="nx-slider__end">{end}</span>}
    </div>
  )
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
  label?: string
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: SegmentedControlProps<T>) {
  return (
    <div className="nx-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          disabled={disabled}
          className={cx(
            "nx-segmented__item",
            option.value === value && "nx-segmented__item--selected",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export interface SelectProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value"
> {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

/** A pop-up button. Native <select>, so keyboard and screen readers work unchanged. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  ...props
}: SelectProps<T>) {
  return (
    <span className={cx("nx-select", className)}>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value as T)} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("nx-textfield", className)} {...props} />
}

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
}: SearchFieldProps) {
  return (
    <div className="nx-search">
      <Search size={14} className="nx-search__icon" aria-hidden="true" />
      <input
        type="search"
        className="nx-search__input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation()
            onChange("")
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="nx-search__clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={10} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

export function Spinner({ size = 16, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span
      className="nx-spinner"
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    />
  )
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "neutral" | "accent" | "success" | "warning" | "danger"
}) {
  return <span className={cx("nx-badge", `nx-badge--${tone}`)}>{children}</span>
}

/** A labelled field for forms inside sheets: label above, control below. */
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: (id: string) => ReactNode
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <div className="nx-field">
      <label className="nx-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <div className="nx-field__hint">{hint}</div>}
    </div>
  )
}
