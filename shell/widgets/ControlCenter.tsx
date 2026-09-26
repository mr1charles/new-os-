import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createBinding, createComputed, createState, For, type Accessor } from "ags"
import { execAsync } from "ags/process"
import PopupWindow from "./PopupWindow"
import type { AstalNetwork, AstalBluetooth } from "../lib/services"
import {
  battery,
  bluetooth,
  mpris,
  network,
  powerProfiles,
  speaker,
  AstalMpris,
} from "../lib/services"
import { config, updateConfig } from "../lib/config"
import { theme } from "../lib/theme"
import { brightness, hasBacklight, setBrightness } from "../lib/brightness"
import { setVolume, toggleMute, volumeIcon } from "../lib/audio"
import { formatPercent, formatRemaining } from "../lib/format"
import { openSettings } from "../lib/system"
import { setImageSource } from "../lib/icons"

const VERTICAL = Gtk.Orientation.VERTICAL
type Page = "main" | "wifi" | "bluetooth"

function constant<T>(value: T): Accessor<T> {
  return createState(value)[0]
}

function Toggle(props: {
  icon: Accessor<string> | string
  title: string
  subtitle: Accessor<string> | string
  active: Accessor<boolean>
  onToggle: () => void
  onMore?: () => void
  wide?: boolean
}) {
  return (
    <box
      class={props.active.as((a) => `cc-toggle ${a ? "active" : ""} ${props.wide ? "wide" : ""}`)}
    >
      <button class="cc-toggle-main" hexpand onClicked={props.onToggle}>
        <box spacing={10}>
          <box class="cc-toggle-icon" valign={Gtk.Align.CENTER}>
            <image iconName={props.icon} pixelSize={16} halign={Gtk.Align.CENTER} hexpand />
          </box>
          <box orientation={VERTICAL} valign={Gtk.Align.CENTER}>
            <label class="cc-toggle-title" label={props.title} xalign={0} />
            <label
              class="cc-toggle-subtitle"
              label={props.subtitle}
              xalign={0}
              ellipsize={Pango.EllipsizeMode.END}
              maxWidthChars={14}
            />
          </box>
        </box>
      </button>
      {props.onMore ? (
        <button class="cc-toggle-more" valign={Gtk.Align.CENTER} onClicked={props.onMore}>
          <image iconName="go-next-symbolic" />
        </button>
      ) : (
        <box />
      )}
    </box>
  )
}

function Module(props: { title: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <box class="cc-module" orientation={VERTICAL} spacing={8}>
      <label class="cc-module-title" label={props.title} xalign={0} />
      {props.children}
    </box>
  )
}

function WifiToggle({ go }: { go: (p: Page) => void }) {
  const wifi = network?.wifi ?? null
  if (!wifi) {
    return (
      <Toggle
        icon="network-wireless-disabled-symbolic"
        title="Wi-Fi"
        subtitle="No adapter"
        active={constant(false)}
        onToggle={() => undefined}
      />
    )
  }
  const enabled = createBinding(wifi, "enabled")
  const ssid = createBinding(wifi, "ssid")
  return (
    <Toggle
      icon={createBinding(wifi, "iconName")}
      title="Wi-Fi"
      subtitle={createComputed(() => (!enabled() ? "Off" : ssid() || "Not Connected"))}
      active={enabled}
      onToggle={() => (wifi.enabled = !wifi.enabled)}
      onMore={() => go("wifi")}
    />
  )
}

function BluetoothToggle({ go }: { go: (p: Page) => void }) {
  if (!bluetooth) {
    return (
      <Toggle
        icon="bluetooth-disabled-symbolic"
        title="Bluetooth"
        subtitle="No adapter"
        active={constant(false)}
        onToggle={() => undefined}
      />
    )
  }
  const bt = bluetooth
  const powered = createBinding(bt, "isPowered")
  const devices = createBinding(bt, "devices")
  const subtitle = createComputed(() => {
    if (!powered()) return "Off"
    const connected = devices().filter((d) => d.connected)
    return connected.length === 1
      ? connected[0]!.alias || connected[0]!.name
      : connected.length > 1
        ? `${connected.length} devices`
        : "On"
  })
  return (
    <Toggle
      icon={powered.as((p) => (p ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic"))}
      title="Bluetooth"
      subtitle={subtitle}
      active={powered}
      onToggle={() => bt.toggle()}
      onMore={() => go("bluetooth")}
    />
  )
}

function AirplaneToggle() {
  const wifiOn = network?.wifi ? createBinding(network.wifi, "enabled") : constant(false)
  const btOn = bluetooth ? createBinding(bluetooth, "isPowered") : constant(false)
  const active = createComputed(() => !wifiOn() && !btOn())
  const toggle = () => {
    const turnOn = !active.peek()
    execAsync(["nmcli", "radio", "all", turnOn ? "off" : "on"]).catch(() => undefined)
    if (bluetooth && bluetooth.isPowered === turnOn) bluetooth.toggle()
  }
  return (
    <Toggle
      icon="airplane-mode-symbolic"
      title="Airplane"
      subtitle={active.as((a) => (a ? "On" : "Off"))}
      active={active}
      onToggle={toggle}
    />
  )
}

function FocusToggle() {
  const active = config.as((c) => c.notifications.doNotDisturb)
  return (
    <Toggle
      icon="weather-clear-night-symbolic"
      title="Focus"
      subtitle={active.as((a) => (a ? "Do Not Disturb" : "Off"))}
      active={active}
      onToggle={() =>
        updateConfig((c) => (c.notifications.doNotDisturb = !c.notifications.doNotDisturb))
      }
      onMore={() => openSettings("focus")}
    />
  )
}

function DarkModeToggle() {
  const active = theme.as((t) => t === "dark")
  return (
    <Toggle
      icon="newos-dark-mode-symbolic"
      title="Dark Mode"
      subtitle={config.as((c) =>
        c.appearance.theme === "auto" ? "Auto" : c.appearance.theme === "dark" ? "On" : "Off",
      )}
      active={active}
      onToggle={() =>
        updateConfig((c) => (c.appearance.theme = theme.peek() === "dark" ? "light" : "dark"))
      }
    />
  )
}

function NightShiftToggle() {
  const active = config.as((c) => c.nightShift.enabled)
  return (
    <Toggle
      icon="night-light-symbolic"
      title="Night Shift"
      subtitle={active.as((a) => (a ? "On" : "Off"))}
      active={active}
      onToggle={() => updateConfig((c) => (c.nightShift.enabled = !c.nightShift.enabled))}
    />
  )
}

function Slider(props: {
  icon: Accessor<string> | string
  value: Accessor<number>
  onChange: (v: number) => void
  onIcon?: () => void
}) {
  return (
    <box class="cc-slider" spacing={8}>
      <button class="cc-slider-icon" onClicked={() => props.onIcon?.()}>
        <image iconName={props.icon} />
      </button>
      <slider
        hexpand
        min={0}
        max={1}
        value={props.value}
        onChangeValue={(_self, _scroll, value) => {
          props.onChange(value)
          return false
        }}
      />
    </box>
  )
}

function DisplayModule() {
  if (!hasBacklight) return <box visible={false} />
  return (
    <Module title="Display">
      <Slider
        icon={brightness.as((b) =>
          b < 0.5 ? "display-brightness-low-symbolic" : "display-brightness-high-symbolic",
        )}
        value={brightness}
        onChange={(v) => setBrightness(v)}
      />
    </Module>
  )
}

function SoundModule() {
  if (!speaker) return <box visible={false} />
  const volume = createBinding(speaker, "volume")
  const mute = createBinding(speaker, "mute")
  return (
    <Module title="Sound">
      <Slider
        icon={createComputed(() => volumeIcon(volume(), mute()))}
        value={volume}
        onChange={setVolume}
        onIcon={toggleMute}
      />
      <label
        class="cc-caption"
        label={createBinding(speaker, "description").as((d) => d ?? "")}
        xalign={0}
        ellipsize={Pango.EllipsizeMode.END}
      />
    </Module>
  )
}

function NowPlaying() {
  if (!mpris) return <box visible={false} />
  const players = createBinding(mpris, "players")
  const current = players.as((list) => list[0] ?? null)
  return (
    <box class="cc-module now-playing" visible={current.as((p) => p !== null)}>
      <For each={players.as((list) => list.slice(0, 1))}>
        {(player: AstalMpris.Player) => (
          <box spacing={12} hexpand>
            <image
              class="cover"
              pixelSize={48}
              overflow={Gtk.Overflow.HIDDEN}
              $={(self) => {
                setImageSource(self, player.coverArt, "audio-x-generic-symbolic")
                player.connect("notify::cover-art", () =>
                  setImageSource(self, player.coverArt, "audio-x-generic-symbolic"),
                )
              }}
            />
            <box orientation={VERTICAL} hexpand valign={Gtk.Align.CENTER}>
              <label
                class="cc-toggle-title"
                label={createBinding(player, "title").as((t) => t ?? "")}
                xalign={0}
                ellipsize={Pango.EllipsizeMode.END}
                maxWidthChars={20}
              />
              <label
                class="cc-caption"
                label={createBinding(player, "artist").as((a) => a ?? "")}
                xalign={0}
                ellipsize={Pango.EllipsizeMode.END}
                maxWidthChars={20}
              />
            </box>
            <button class="flat-icon" onClicked={() => player.previous()}>
              <image iconName="media-skip-backward-symbolic" />
            </button>
            <button class="flat-icon" onClicked={() => player.play_pause()}>
              <image
                iconName={createBinding(player, "playbackStatus").as((s) =>
                  s === AstalMpris.PlaybackStatus.PLAYING
                    ? "media-playback-pause-symbolic"
                    : "media-playback-start-symbolic",
                )}
              />
            </button>
            <button class="flat-icon" onClicked={() => player.next()}>
              <image iconName="media-skip-forward-symbolic" />
            </button>
          </box>
        )}
      </For>
    </box>
  )
}

const PROFILE_LABELS: Record<string, string> = {
  "power-saver": "Low Power",
  balanced: "Balanced",
  performance: "Performance",
}

function BatteryModule() {
  if (!battery) return <box visible={false} />
  const device = battery
  const percent = createBinding(device, "percentage")
  const charging = createBinding(device, "charging")
  const toEmpty = createBinding(device, "timeToEmpty")
  const toFull = createBinding(device, "timeToFull")
  const detail = createComputed(() => {
    if (charging()) {
      const full = formatRemaining(toFull())
      return full ? `Charging · ${full} until full` : "Charging"
    }
    const left = formatRemaining(toEmpty())
    return left ? `${left} remaining` : "On battery"
  })
  const active = powerProfiles ? createBinding(powerProfiles, "activeProfile") : constant("")
  return (
    <Module title="Battery">
      <box spacing={10}>
        <image iconName={createBinding(device, "batteryIconName")} pixelSize={22} />
        <label class="cc-battery-percent" label={percent.as(formatPercent)} />
        <label class="cc-caption" label={detail} hexpand xalign={1} />
      </box>
      <box class="segmented" homogeneous visible={powerProfiles !== null}>
        {Object.entries(PROFILE_LABELS).map(([profile, label]) => (
          <button
            class={active.as((a) => (a === profile ? "segment active" : "segment"))}
            label={label}
            onClicked={() => {
              if (powerProfiles) powerProfiles.activeProfile = profile
            }}
          />
        ))}
      </box>
    </Module>
  )
}

function PageHeader(props: {
  title: string
  back: () => void
  active: Accessor<boolean>
  onToggle: (on: boolean) => void
}) {
  return (
    <box class="cc-page-header" spacing={8}>
      <button class="flat-icon" onClicked={props.back}>
        <image iconName="go-previous-symbolic" />
      </button>
      <label class="cc-page-title" label={props.title} hexpand xalign={0} />
      <switch
        active={props.active}
        valign={Gtk.Align.CENTER}
        onStateSet={(_self, state) => {
          props.onToggle(state)
          return false
        }}
      />
    </box>
  )
}

function WifiPage({ go }: { go: (p: Page) => void }) {
  const wifi = network?.wifi ?? null
  if (!wifi) return <box $type="named" name="wifi" />
  const [expanded, setExpanded] = createState<string | null>(null)
  const [status, setStatus] = createState("")
  const points = createBinding(wifi, "accessPoints").as((list) => {
    const bySsid = new Map<string, AstalNetwork.AccessPoint>()
    for (const ap of list) {
      if (!ap.ssid) continue
      const existing = bySsid.get(ap.ssid)
      if (!existing || ap.strength > existing.strength) bySsid.set(ap.ssid, ap)
    }
    return [...bySsid.values()].sort((a, b) => b.strength - a.strength).slice(0, 12)
  })
  const activeSsid = createBinding(wifi, "ssid")

  const connect = (ap: AstalNetwork.AccessPoint, password?: string) => {
    setStatus(`Connecting to ${ap.ssid}…`)
    ap.activate(password ?? null)
      .then(() => {
        setStatus("")
        setExpanded(null)
      })
      .catch((error: unknown) =>
        setStatus(`Could not connect: ${String(error).replace(/^.*: /, "")}`),
      )
  }

  return (
    <box $type="named" name="wifi" orientation={VERTICAL} spacing={8} class="cc-page">
      <PageHeader
        title="Wi-Fi"
        back={() => go("main")}
        active={createBinding(wifi, "enabled")}
        onToggle={(on) => (wifi.enabled = on)}
      />
      <scrolledwindow
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        propagateNaturalHeight
        maxContentHeight={380}
      >
        <box orientation={VERTICAL} spacing={2}>
          <For each={points} id={(ap) => ap.ssid ?? ap.bssid}>
            {(ap) => (
              <box orientation={VERTICAL}>
                <button
                  class={activeSsid.as((s) =>
                    s === ap.ssid ? "cc-list-row active" : "cc-list-row",
                  )}
                  onClicked={() => {
                    if (activeSsid.peek() === ap.ssid) return
                    if (ap.requiresPassword && ap.get_connections().length === 0)
                      setExpanded(ap.ssid)
                    else connect(ap)
                  }}
                >
                  <box spacing={10}>
                    <image iconName={ap.iconName} />
                    <label
                      label={ap.ssid ?? ""}
                      hexpand
                      xalign={0}
                      ellipsize={Pango.EllipsizeMode.END}
                    />
                    <image
                      iconName="network-wireless-encrypted-symbolic"
                      visible={ap.requiresPassword}
                    />
                    <image
                      iconName="object-select-symbolic"
                      visible={activeSsid.as((s) => s === ap.ssid)}
                    />
                  </box>
                </button>
                <entry
                  class="cc-password"
                  visible={expanded.as((e) => e === ap.ssid)}
                  visibility={false}
                  placeholderText="Password"
                  onActivate={(self) => connect(ap, self.text)}
                />
              </box>
            )}
          </For>
        </box>
      </scrolledwindow>
      <label
        class="cc-caption"
        label={status}
        visible={status.as((s) => s.length > 0)}
        wrap
        xalign={0}
      />
      <button
        class="cc-link"
        label="Wi-Fi Settings…"
        onClicked={() => openSettings("wifi")}
        halign={Gtk.Align.START}
      />
    </box>
  )
}

function BluetoothPage({ go }: { go: (p: Page) => void }) {
  if (!bluetooth) return <box $type="named" name="bluetooth" />
  const bt = bluetooth
  const devices = createBinding(bt, "devices").as((list) =>
    [...list]
      .filter((d) => d.name)
      .sort(
        (a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired),
      ),
  )
  const toggleDevice = (device: AstalBluetooth.Device) => {
    const action = device.connected ? device.disconnect_device() : device.connect_device()
    action.catch((error: unknown) => console.warn(`newos: bluetooth: ${error}`))
  }
  return (
    <box $type="named" name="bluetooth" orientation={VERTICAL} spacing={8} class="cc-page">
      <PageHeader
        title="Bluetooth"
        back={() => go("main")}
        active={createBinding(bt, "isPowered")}
        onToggle={(on) => {
          if (bt.isPowered !== on) bt.toggle()
        }}
      />
      <scrolledwindow
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        propagateNaturalHeight
        maxContentHeight={380}
      >
        <box orientation={VERTICAL} spacing={2}>
          <For each={devices} id={(d) => d.address}>
            {(device) => {
              const connected = createBinding(device, "connected")
              const connecting = createBinding(device, "connecting")
              const state = createComputed(() =>
                connecting()
                  ? "Connecting…"
                  : connected()
                    ? "Connected"
                    : device.paired
                      ? ""
                      : "Not paired",
              )
              return (
                <button
                  class={connected.as((c) => (c ? "cc-list-row active" : "cc-list-row"))}
                  onClicked={() => toggleDevice(device)}
                >
                  <box spacing={10}>
                    <image
                      iconName={
                        device.icon ? `${device.icon}-symbolic` : "bluetooth-active-symbolic"
                      }
                    />
                    <label
                      label={device.alias || device.name}
                      hexpand
                      xalign={0}
                      ellipsize={Pango.EllipsizeMode.END}
                    />
                    <label class="cc-caption" label={state} />
                  </box>
                </button>
              )
            }}
          </For>
        </box>
      </scrolledwindow>
      <button
        class="cc-link"
        label="Bluetooth Settings…"
        onClicked={() => openSettings("bluetooth")}
        halign={Gtk.Align.START}
      />
    </box>
  )
}

/** Control Center: quick toggles, sliders, Now Playing, and battery, top right under the bar. */
export default function ControlCenter() {
  const [page, setPage] = createState<Page>("main")
  const go = (next: Page) => {
    if (next === "wifi") network?.wifi?.scan()
    setPage(next)
  }

  return (
    <PopupWindow
      name="control-center"
      namespace="newos-control-center"
      halign={Gtk.Align.END}
      valign={Gtk.Align.START}
      marginTop={6}
      marginEnd={8}
      onShow={() => setPage("main")}
    >
      <box class="control-center panel" orientation={VERTICAL}>
        <stack
          visibleChildName={page}
          transitionType={Gtk.StackTransitionType.SLIDE_LEFT_RIGHT}
          transitionDuration={220}
          interpolateSize
          vhomogeneous={false}
        >
          <box $type="named" name="main" orientation={VERTICAL} spacing={10}>
            <box spacing={10} homogeneous>
              <box class="cc-module connectivity" orientation={VERTICAL} spacing={6}>
                <WifiToggle go={go} />
                <BluetoothToggle go={go} />
                <AirplaneToggle />
              </box>
              <box orientation={VERTICAL} spacing={6} class="cc-module">
                <FocusToggle />
                <DarkModeToggle />
                <NightShiftToggle />
              </box>
            </box>
            <DisplayModule />
            <SoundModule />
            <NowPlaying />
            <BatteryModule />
          </box>
          <WifiPage go={go} />
          <BluetoothPage go={go} />
        </stack>
      </box>
    </PopupWindow>
  )
}
