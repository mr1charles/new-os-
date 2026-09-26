import { call, type BluetoothDevice } from "@helixos/sdk"
import { useAction, useCommand } from "@helixos/sdk/react"
import { Badge, Button, EmptyState, Group, Page, Row, Spinner, Toggle } from "@helixos/ui"
import {
  BluetoothOff,
  Gamepad2,
  Headphones,
  Keyboard,
  Monitor,
  Mouse,
  Phone,
  Speaker,
  Watch,
  X,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"
import { ActionError, LoadError } from "../components/common"

/** BlueZ reports a freedesktop icon name for the device class. */
function deviceIcon(icon: string): LucideIcon {
  if (icon.startsWith("audio-head")) return Headphones
  if (icon.startsWith("audio")) return Speaker
  if (icon === "input-mouse" || icon === "input-tablet") return Mouse
  if (icon === "input-keyboard") return Keyboard
  if (icon === "input-gaming") return Gamepad2
  if (icon === "phone") return Phone
  if (icon.includes("watch")) return Watch
  return Monitor
}

function DeviceRow({
  device,
  busy,
  onAction,
}: {
  device: BluetoothDevice
  busy: boolean
  onAction: (kind: "pair" | "connect" | "disconnect" | "remove") => void
}) {
  const Icon = deviceIcon(device.icon)
  const status = device.connected ? "Connected" : device.paired ? "Not Connected" : undefined
  return (
    <Row
      label={device.name}
      description={status}
      icon={<Icon size={18} className="settings-muted" />}
    >
      {device.battery !== null && <Badge>{device.battery}%</Badge>}
      {busy ? (
        <Spinner size={14} />
      ) : !device.paired ? (
        <Button size="small" onClick={() => onAction("pair")}>
          Connect
        </Button>
      ) : device.connected ? (
        <Button size="small" onClick={() => onAction("disconnect")}>
          Disconnect
        </Button>
      ) : (
        <Button size="small" onClick={() => onAction("connect")}>
          Connect
        </Button>
      )}
      {device.paired && !busy && (
        <button
          type="button"
          className="nx-icon-button"
          aria-label={`Forget ${device.name}`}
          title="Forget This Device"
          onClick={() => onAction("remove")}
        >
          <X size={14} />
        </button>
      )}
    </Row>
  )
}

export function BluetoothPage() {
  const powered = useCommand("bluetooth_powered", undefined, { refreshMs: 5000 })
  const devices = useCommand("bluetooth_devices", undefined, {
    refreshMs: 5000,
    enabled: powered.data ?? true,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const toggle = useAction(async (enabled: boolean) => {
    await call("bluetooth_set_enabled", { enabled })
    await Promise.all([powered.reload(), devices.reload()])
  })
  const act = useAction(
    async (device: BluetoothDevice, kind: "pair" | "connect" | "disconnect" | "remove") => {
      setBusy(device.address)
      try {
        // Each action is its own command with the same argument shape.
        await call(`bluetooth_${kind}` as "bluetooth_connect", { address: device.address })
      } finally {
        setBusy(null)
        await devices.reload()
      }
    },
  )
  const scan = async () => {
    setScanning(true)
    try {
      await call("bluetooth_scan", { seconds: 8 })
      await devices.reload()
    } finally {
      setScanning(false)
    }
  }

  if (powered.error)
    return (
      <Page>
        <LoadError error={powered.error} retry={() => void powered.reload()} />
      </Page>
    )
  if (powered.data === undefined) return <Page>{null}</Page>

  const on = powered.data
  const list = devices.data ?? []
  const mine = list.filter((d) => d.paired)
  const nearby = list.filter((d) => !d.paired)

  return (
    <Page>
      <Group>
        <Row label="Bluetooth">
          <Toggle
            label="Bluetooth"
            checked={on}
            disabled={toggle.pending}
            onChange={(v) => void toggle.run(v)}
          />
        </Row>
      </Group>
      <ActionError error={toggle.error ?? act.error} />
      {on ? (
        <>
          <Group title="My Devices">
            {mine.length === 0 ? (
              <EmptyState title="No devices" />
            ) : (
              mine.map((d) => (
                <DeviceRow
                  key={d.address}
                  device={d}
                  busy={busy === d.address}
                  onAction={(k) => void act.run(d, k)}
                />
              ))
            )}
          </Group>
          <Group
            title="Nearby Devices"
            titleAccessory={
              <Button size="small" disabled={scanning} onClick={() => void scan()}>
                {scanning && <Spinner size={12} label="Searching" />}
                {scanning ? "Searching…" : "Search"}
              </Button>
            }
            footer="Put the device in pairing mode, then search."
          >
            {nearby.length === 0 ? (
              <EmptyState title={scanning ? "Searching…" : "No new devices found"} />
            ) : (
              nearby.map((d) => (
                <DeviceRow
                  key={d.address}
                  device={d}
                  busy={busy === d.address}
                  onAction={(k) => void act.run(d, k)}
                />
              ))
            )}
          </Group>
        </>
      ) : (
        <EmptyState icon={<BluetoothOff size={36} />} title="Bluetooth is off" />
      )}
    </Page>
  )
}
