import { call, type AudioDevice } from "@newos/sdk"
import { useAction, useCommand } from "@newos/sdk/react"
import { EmptyState, Group, Page, Row, Slider, Toggle } from "@newos/ui"
import { Check, Mic, Volume, Volume2 } from "lucide-react"
import { useEffect, useState } from "react"
import { ActionError, LoadError } from "../components/common"

/** A volume slider that follows the device but does not jump while being dragged. */
function VolumeControl({
  device,
  label,
  onChanged,
}: {
  device: AudioDevice
  label: string
  onChanged: () => void
}) {
  const [level, setLevel] = useState(device.volume.level)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) setLevel(device.volume.level)
  }, [device.volume.level, dragging])
  const set = useAction(async (next: number, muted: boolean) => {
    await call("audio_set_volume", { id: device.id, level: next, muted })
    onChanged()
  })
  return (
    <>
      <Row label={label} stacked>
        <Slider
          label={label}
          value={level}
          onChange={(v) => {
            setDragging(true)
            setLevel(v)
          }}
          onCommit={(v) => {
            setDragging(false)
            void set.run(v, v === 0)
          }}
          start={<Volume size={14} />}
          end={<Volume2 size={14} />}
        />
      </Row>
      <Row label="Mute">
        <Toggle
          label={`Mute ${device.name}`}
          checked={device.volume.muted}
          onChange={(m) => void set.run(level, m)}
        />
      </Row>
      <ActionError error={set.error} />
    </>
  )
}

function DeviceList({ devices, onPick }: { devices: AudioDevice[]; onPick: (id: number) => void }) {
  if (devices.length === 0) return <EmptyState title="No devices" />
  return (
    <>
      {devices.map((d) => (
        <Row key={d.id} label={d.name} onClick={d.is_default ? undefined : () => onPick(d.id)}>
          {d.is_default && <Check size={16} className="settings-accent" aria-label="Selected" />}
        </Row>
      ))}
    </>
  )
}

export function SoundPage() {
  const devices = useCommand("audio_devices", undefined, { refreshMs: 3000 })
  const pick = useAction(async (id: number) => {
    await call("audio_set_default", { id })
    await devices.reload()
  })
  if (devices.error)
    return (
      <Page>
        <LoadError error={devices.error} retry={() => void devices.reload()} />
      </Page>
    )
  const outputs = devices.data?.outputs ?? []
  const inputs = devices.data?.inputs ?? []
  const output = outputs.find((d) => d.is_default)
  const input = inputs.find((d) => d.is_default)
  const reload = () => void devices.reload()
  return (
    <Page>
      <Group title="Output">
        {output && <VolumeControl device={output} label="Output volume" onChanged={reload} />}
      </Group>
      <Group title="Play sound through">
        <DeviceList devices={outputs} onPick={(id) => void pick.run(id)} />
      </Group>
      <Group title="Input">
        {input && <VolumeControl device={input} label="Input volume" onChanged={reload} />}
      </Group>
      <Group
        title="Use microphone"
        footer={
          <>
            <Mic size={11} /> The microphone button on the keyboard mutes the selected microphone.
          </>
        }
      >
        <DeviceList devices={inputs} onPick={(id) => void pick.run(id)} />
      </Group>
      <ActionError error={pick.error} />
    </Page>
  )
}
