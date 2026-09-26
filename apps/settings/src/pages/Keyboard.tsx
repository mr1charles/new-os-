import { Group, Page, Row, Select, Toggle, Value } from "@helixos/ui"
import { ActionError, LoadError } from "../components/common"
import { HyprSlider, HyprToggle, useHyprOptions } from "../components/HyprOptions"

const LAYOUTS = [
  { value: "us", label: "U.S." },
  { value: "us:intl", label: "U.S. International" },
  { value: "us:dvorak", label: "Dvorak" },
  { value: "us:colemak", label: "Colemak" },
  { value: "gb", label: "British" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "br", label: "Brazilian" },
  { value: "latam", label: "Latin American" },
  { value: "ru", label: "Russian" },
  { value: "jp", label: "Japanese" },
]

const SHORTCUTS: [string, string][] = [
  ["Super Space", "Assistant"],
  ["Super A", "Spotlight search"],
  ["Super Shift A", "Launchpad"],
  ["Super Tab", "Switch apps"],
  ["Super ,", "Settings"],
  ["Super Q / W", "Quit or close the window"],
  ["Super M", "Minimize"],
  ["Super L", "Lock the screen"],
  ["Ctrl ← / →", "Previous or next desktop"],
  ["Ctrl ↑", "Mission Control"],
  ["Super Shift 3 / 4", "Screenshot of the screen / an area"],
]

export function KeyboardPage() {
  const options = useHyprOptions()
  const layout = options.value("input:kb_layout") ?? "us"
  const variant = options.value("input:kb_variant") ?? ""
  const current = variant ? `${layout}:${variant}` : layout
  const layoutOptions = LAYOUTS.some((l) => l.value === current)
    ? LAYOUTS
    : [{ value: current, label: current }, ...LAYOUTS]
  const kbOptions = (options.value("input:kb_options") ?? "").split(",").filter(Boolean)
  const capsIsCtrl = kbOptions.includes("ctrl:nocaps")

  if (options.loadError)
    return (
      <Page>
        <LoadError error={options.loadError} />
      </Page>
    )

  return (
    <Page>
      <Group title="Key Repeat">
        <HyprSlider
          options={options}
          option="input:repeat_rate"
          label="Key repeat rate"
          min={5}
          max={60}
          step={1}
          start="Slow"
          end="Fast"
        />
        <HyprSlider
          options={options}
          option="input:repeat_delay"
          label="Delay until repeat"
          min={150}
          max={1000}
          step={25}
          start="Long"
          end="Short"
          invert
        />
      </Group>
      <Group title="Input">
        <Row label="Keyboard layout">
          <Select
            aria-label="Keyboard layout"
            value={current}
            options={layoutOptions}
            disabled={!options.loaded}
            onChange={(v) => {
              const [l, variantName = ""] = v.split(":")
              void options
                .set("input:kb_layout", l!)
                .then(() => options.set("input:kb_variant", variantName))
            }}
          />
        </Row>
        <Row label="Caps Lock acts as Control">
          <Toggle
            label="Caps Lock acts as Control"
            checked={capsIsCtrl}
            disabled={!options.loaded}
            onChange={(on) => {
              const rest = kbOptions.filter((o) => o !== "ctrl:nocaps")
              void options.set("input:kb_options", (on ? [...rest, "ctrl:nocaps"] : rest).join(","))
            }}
          />
        </Row>
        <HyprToggle
          options={options}
          option="input:numlock_by_default"
          label="Num Lock on at startup"
        />
      </Group>
      <ActionError error={options.error} />
      <Group title="Keyboard Shortcuts">
        {SHORTCUTS.map(([keys, action]) => (
          <Row key={keys} label={action}>
            <Value>
              <kbd className="settings-kbd">{keys}</kbd>
            </Value>
          </Row>
        ))}
      </Group>
    </Page>
  )
}
