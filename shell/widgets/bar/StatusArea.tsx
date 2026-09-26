import { createBinding, createComputed, createState, type Accessor } from "ags"
import { battery, bluetooth, network, speaker, AstalNetwork } from "../../lib/services"
import { config } from "../../lib/config"
import { formatClock } from "../../lib/format"
import { now } from "../../lib/clock"
import { togglePopup } from "../../lib/popups"
import { volumeIcon } from "../../lib/audio"

function constant<T>(value: T): Accessor<T> {
  return createState(value)[0]
}

export function networkIcon(): Accessor<string> {
  if (!network) return constant("network-offline-symbolic")
  const primary = createBinding(network, "primary")
  const wifiIcon = network.wifi ? createBinding(network.wifi, "iconName") : null
  const wiredIcon = network.wired ? createBinding(network.wired, "iconName") : null
  return createComputed(() => {
    if (primary() === AstalNetwork.Primary.WIRED && wiredIcon) return wiredIcon()
    return wifiIcon ? wifiIcon() : "network-offline-symbolic"
  })
}

function BatteryIndicator() {
  if (!battery) return <box visible={false} />
  const percent = createBinding(battery, "percentage")
  const charging = createBinding(battery, "charging")
  const label = createComputed(() =>
    config().bar.showBatteryPercent ? `${Math.round(percent() * 100)}%` : "",
  )
  const cls = createComputed(() => {
    const p = percent()
    if (charging()) return "battery charging"
    return p <= 0.1 ? "battery critical" : p <= 0.2 ? "battery low" : "battery"
  })
  return (
    <button class="bar-item" tooltipText="Battery" onClicked={() => togglePopup("control-center")}>
      <box class={cls} spacing={4}>
        <label class="battery-percent" label={label} visible={label.as((l) => l.length > 0)} />
        <image iconName={createBinding(battery, "batteryIconName")} />
      </box>
    </button>
  )
}

function BluetoothIndicator() {
  if (!bluetooth) return <box visible={false} />
  const connected = createBinding(bluetooth, "isConnected")
  return (
    <button
      class="bar-item"
      visible={createBinding(bluetooth, "isPowered")}
      tooltipText="Bluetooth"
      onClicked={() => togglePopup("control-center")}
    >
      <image
        iconName={connected.as((c) => (c ? "bluetooth-active-symbolic" : "bluetooth-symbolic"))}
      />
    </button>
  )
}

function VolumeIndicator() {
  if (!speaker) return <box visible={false} />
  const volume = createBinding(speaker, "volume")
  const mute = createBinding(speaker, "mute")
  return (
    <button class="bar-item" tooltipText="Sound" onClicked={() => togglePopup("control-center")}>
      <image iconName={createComputed(() => volumeIcon(volume(), mute()))} />
    </button>
  )
}

export function Clock() {
  const label = createComputed(() => {
    const bar = config().bar
    return formatClock(new Date(now()), bar.clock24h, bar.showSeconds)
  })
  return (
    <button class="bar-item clock" onClicked={() => togglePopup("notification-center")}>
      <label label={label} />
    </button>
  )
}

/** Right side of the bar: status icons, Control Center, the assistant, and the clock. */
export default function StatusArea() {
  return (
    <box class="status-area" spacing={2}>
      <BatteryIndicator />
      <BluetoothIndicator />
      <button class="bar-item" tooltipText="Wi-Fi" onClicked={() => togglePopup("control-center")}>
        <image iconName={networkIcon()} />
      </button>
      <VolumeIndicator />
      <button
        class="bar-item"
        tooltipText="Control Center"
        onClicked={() => togglePopup("control-center")}
      >
        <image iconName="helixos-control-center-symbolic" />
      </button>
      <button
        class="bar-item assistant-button"
        tooltipText="Assistant (Super+Space)"
        onClicked={() => togglePopup("assistant")}
      >
        <image iconName="helixos-sparkle-symbolic" />
      </button>
      <Clock />
    </box>
  )
}
