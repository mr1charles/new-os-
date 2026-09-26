import { call, type Monitor, type MonitorSetup } from "@helixos/sdk"
import { useAction, useCommand, useSettings } from "@helixos/sdk/react"
import {
  Button,
  Group,
  Page,
  Row,
  SegmentedControl,
  Select,
  Sheet,
  Slider,
  Toggle,
} from "@helixos/ui"
import { Sun, SunDim } from "lucide-react"
import { useEffect, useState } from "react"
import { ActionError, LoadError } from "../components/common"
import { looksLike, parseMode } from "../format"

const SCALES = [1, 1.25, 1.5, 1.75, 2]
const ROTATIONS = [
  { value: "0", label: "Standard" },
  { value: "1", label: "90°" },
  { value: "2", label: "180°" },
  { value: "3", label: "270°" },
]
const REVERT_SECONDS = 15

function setupOf(m: Monitor): MonitorSetup {
  return {
    name: m.name,
    mode: `${m.width}x${m.height}@${m.refresh_rate.toFixed(2)}`,
    x: m.x,
    y: m.y,
    scale: m.scale,
    transform: m.transform,
    disabled: m.disabled,
  }
}

function sameSetup(a: MonitorSetup, b: MonitorSetup) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** After a change, ask to keep it and revert on its own if nobody answers (a blank screen). */
function ConfirmSheet({ onKeep, onRevert }: { onKeep: () => void; onRevert: () => void }) {
  const [left, setLeft] = useState(REVERT_SECONDS)
  useEffect(() => {
    if (left <= 0) {
      onRevert()
      return
    }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [left, onRevert])
  return (
    <Sheet
      open
      onClose={onRevert}
      title="Keep these display settings?"
      actions={
        <>
          <Button onClick={onRevert}>Revert</Button>
          <Button variant="primary" onClick={onKeep}>
            Keep Changes
          </Button>
        </>
      }
    >
      The previous settings come back in {left} second{left === 1 ? "" : "s"}.
    </Sheet>
  )
}

function MonitorGroup({ monitor, onChanged }: { monitor: Monitor; onChanged: () => void }) {
  const current = setupOf(monitor)
  const [draft, setDraft] = useState(current)
  const [previous, setPrevious] = useState<MonitorSetup | null>(null)
  useEffect(() => setDraft(setupOf(monitor)), [monitor])

  const apply = useAction(async (setup: MonitorSetup) => {
    await call("monitor_apply", { setup })
    onChanged()
  })

  const modes = monitor.available_modes
    .map(parseMode)
    .filter((m): m is NonNullable<ReturnType<typeof parseMode>> => m !== null)
  const options = modes.map((m) => ({
    value: m.value,
    label: `${m.width} × ${m.height}, ${Math.round(m.refresh)} Hz`,
  }))
  if (!options.some((o) => o.value === draft.mode)) {
    options.unshift({
      value: draft.mode,
      label: draft.mode.replace("@", ", ").replace(/\.\d+$/, " Hz"),
    })
  }
  const [width, height] = draft.mode.split("@")[0]!.split("x").map(Number) as [number, number]

  return (
    <Group
      title={
        /^(eDP|LVDS|DSI)/.test(monitor.name)
          ? "Built-in Display"
          : monitor.description || monitor.name
      }
      footer={`${monitor.description || monitor.name} · Looks like ${looksLike(width, height, draft.scale)}`}
    >
      <Row label="Resolution">
        <Select
          aria-label="Resolution"
          value={draft.mode}
          options={options}
          onChange={(mode) => setDraft({ ...draft, mode })}
        />
      </Row>
      <Row label="Scale" description="Larger text and controls, less space.">
        <SegmentedControl
          label="Scale"
          value={String(draft.scale)}
          options={SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))}
          onChange={(v) => setDraft({ ...draft, scale: Number(v) })}
        />
      </Row>
      <Row label="Rotation">
        <Select
          aria-label="Rotation"
          value={String(draft.transform)}
          options={ROTATIONS}
          onChange={(v) => setDraft({ ...draft, transform: Number(v) })}
        />
      </Row>
      {!sameSetup(draft, current) && (
        <Row label="">
          <Button onClick={() => setDraft(current)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={apply.pending}
            onClick={async () => {
              setPrevious(current)
              await apply.run(draft)
            }}
          >
            Apply
          </Button>
        </Row>
      )}
      <ActionError error={apply.error} />
      {previous && !apply.pending && !apply.error && (
        <ConfirmSheet
          onKeep={() => setPrevious(null)}
          onRevert={() => {
            const back = previous
            setPrevious(null)
            void apply.run(back)
          }}
        />
      )}
    </Group>
  )
}

function BrightnessRow() {
  const brightness = useCommand("brightness_get")
  const [level, setLevel] = useState<number | null>(null)
  const set = useAction((value: number) => call("brightness_set", { level: value }))
  if (brightness.error) return null
  return (
    <Row label="Brightness" stacked>
      <Slider
        label="Brightness"
        min={0.01}
        value={level ?? brightness.data ?? 0.5}
        onChange={(v) => {
          setLevel(v)
          void set.run(v)
        }}
        start={<SunDim size={14} />}
        end={<Sun size={14} />}
      />
    </Row>
  )
}

export function DisplaysPage() {
  const monitors = useCommand("monitors")
  const [settings, update] = useSettings()
  const night = settings.nightShift
  // Left is warmer, so the slider runs over 8500 - kelvin (6000 K ... 2500 K).
  const [warmth, setWarmth] = useState<number | null>(null)
  return (
    <Page>
      <Group>
        <BrightnessRow />
      </Group>
      {monitors.error ? (
        <LoadError error={monitors.error} retry={() => void monitors.reload()} />
      ) : (
        (monitors.data ?? []).map((m) => (
          <MonitorGroup key={m.name} monitor={m} onChanged={() => void monitors.reload()} />
        ))
      )}
      <Group title="Night Shift" footer="Warmer colors are easier on the eyes at night.">
        <Row label="Night Shift">
          <Toggle
            label="Night Shift"
            checked={night.enabled}
            onChange={(v) => void update({ nightShift: { enabled: v } })}
          />
        </Row>
        <Row label="Color temperature" stacked>
          <Slider
            label="Color temperature"
            min={2500}
            max={6000}
            step={100}
            value={warmth ?? 8500 - night.temperature}
            onChange={setWarmth}
            onCommit={(v) => {
              setWarmth(null)
              void update({ nightShift: { temperature: 8500 - v } })
            }}
            disabled={!night.enabled}
            start="Less Warm"
            end="More Warm"
          />
        </Row>
      </Group>
    </Page>
  )
}
