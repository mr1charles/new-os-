import { call } from "@helixos/sdk"
import { useCommand } from "@helixos/sdk/react"
import { Row, Slider, Toggle } from "@helixos/ui"
import { useState } from "react"

/**
 * Hyprland input options, applied live and saved to hyprland-settings.conf by the backend.
 * Values are strings as Hyprland reports them ("true", "25", "0.6").
 */
export function useHyprOptions() {
  const options = useCommand("hypr_options")
  const [local, setLocal] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const value = (key: string) => local[key] ?? options.data?.[key]
  const set = async (key: string, next: string) => {
    setLocal((l) => ({ ...l, [key]: next }))
    setError(null)
    try {
      const saved = await call("hypr_option_set", { key, value: next })
      setLocal((l) => ({ ...l, [key]: saved }))
    } catch (e) {
      setLocal(({ [key]: _, ...rest }) => rest)
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return { value, set, error, loadError: options.error, loaded: options.data !== undefined }
}

type Options = ReturnType<typeof useHyprOptions>

export function HyprToggle({
  options,
  option,
  label,
  description,
  disabled,
}: {
  options: Options
  option: string
  label: string
  description?: string
  /** Force it off even once the value has loaded (the preview's nested mode). */
  disabled?: boolean
}) {
  const raw = options.value(option)
  return (
    <Row label={label} description={description}>
      <Toggle
        label={label}
        checked={raw === "true" || raw === "1"}
        disabled={disabled || raw === undefined}
        onChange={(v) => void options.set(option, String(v))}
      />
    </Row>
  )
}

export function HyprSlider({
  options,
  option,
  label,
  min,
  max,
  step,
  start,
  end,
  invert = false,
  disabled,
}: {
  options: Options
  option: string
  label: string
  min: number
  max: number
  step: number
  start?: string
  end?: string
  /** For options where a smaller number feels "more" (key repeat delay). */
  invert?: boolean
  /** Force it off even once the value has loaded (the preview's nested mode). */
  disabled?: boolean
}) {
  const raw = Number(options.value(option) ?? (min + max) / 2)
  const [drag, setDrag] = useState<number | null>(null)
  const toSlider = (v: number) => (invert ? max + min - v : v)
  const round = (v: number) => Math.round(v / step) * step
  return (
    <Row label={label} stacked>
      <Slider
        label={label}
        min={min}
        max={max}
        step={step}
        value={drag ?? toSlider(raw)}
        onChange={setDrag}
        disabled={disabled}
        onCommit={(v) => {
          setDrag(null)
          const next = round(toSlider(v))
          void options.set(option, String(Number(next.toFixed(3))))
        }}
        start={start}
        end={end}
      />
    </Row>
  )
}
