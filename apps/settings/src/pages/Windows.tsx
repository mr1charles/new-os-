import type { AnimationLevel, WindowControls, WindowLayout } from "@newos/sdk"
import { useSettings } from "@newos/sdk/react"
import { Group, Page, Row, SegmentedControl, Slider, Toggle } from "@newos/ui"
import { useEffect, useState } from "react"

/** A slider that applies when you let go (each change reloads the window manager). */
function CommitSlider(props: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}) {
  const [value, setValue] = useState(props.value)
  useEffect(() => setValue(props.value), [props.value])
  return (
    <div className="settings-slider-row">
      <Slider
        label={props.label}
        value={value}
        min={props.min}
        max={props.max}
        step={1}
        onChange={setValue}
        onCommit={props.onCommit}
      />
      <span className="settings-slider-value">{value} px</span>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ["Super+Ctrl+← / →", "Left or right half; press again for thirds"],
  ["Super+Ctrl+↑ / ↓", "Quarters from a half, maximize, or center"],
  ["Super+Ctrl+Return", "Fill the screen"],
  ["Super+Ctrl+G", "Arrange every window on the desktop"],
  ["Super+T", "Tile or float one window"],
]

export function WindowsPage() {
  const [settings, update] = useSettings()
  const w = settings.windows
  return (
    <Page>
      <Group
        title="Layout"
        footer={
          w.layout === "floating"
            ? "Windows open where you put them. Snap them into halves and quarters with the shortcuts below."
            : w.layout === "arrange"
              ? "Whenever a window opens or closes, the desktop re-arranges: one window fills it, two take halves, four take quarters."
              : "Every window tiles automatically and new ones split the space. Dialogs still float."
        }
      >
        <Row label="Windows">
          <SegmentedControl<WindowLayout>
            label="Window layout"
            value={w.layout}
            options={[
              { value: "floating", label: "Floating" },
              { value: "arrange", label: "Auto-Arrange" },
              { value: "tiling", label: "Tiling" },
            ]}
            onChange={(layout) => void update({ windows: { layout } })}
          />
        </Row>
      </Group>
      <Group title="Look">
        <Row label="Window buttons" description="Where close, minimize, and zoom go.">
          <SegmentedControl<WindowControls>
            label="Window buttons"
            value={w.controls}
            options={[
              { value: "mac", label: "Left (colored)" },
              { value: "windows", label: "Right (Windows)" },
            ]}
            onChange={(controls) => void update({ windows: { controls } })}
          />
        </Row>
        <Row label="Corner roundness">
          <CommitSlider
            label="Corner roundness"
            value={w.rounding}
            min={0}
            max={28}
            onCommit={(rounding) => void update({ windows: { rounding } })}
          />
        </Row>
        <Row label="Space between windows">
          <CommitSlider
            label="Space between windows"
            value={w.gaps}
            min={0}
            max={40}
            onCommit={(gaps) => void update({ windows: { gaps } })}
          />
        </Row>
        <Row label="Blur behind translucent windows">
          <Toggle
            label="Blur"
            checked={w.blur}
            onChange={(blur) => void update({ windows: { blur } })}
          />
        </Row>
        <Row label="Animations">
          <SegmentedControl<AnimationLevel>
            label="Animations"
            value={w.animations}
            options={[
              { value: "full", label: "Full" },
              { value: "reduced", label: "Reduced" },
              { value: "off", label: "Off" },
            ]}
            onChange={(animations) => void update({ windows: { animations } })}
          />
        </Row>
      </Group>
      <Group title="Snapping shortcuts">
        {SHORTCUTS.map(([keys, what]) => (
          <Row key={keys} label={what}>
            <kbd className="settings-kbd">{keys}</kbd>
          </Row>
        ))}
      </Group>
    </Page>
  )
}
