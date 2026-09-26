/**
 * One stack page per island state. Each page reads the latest payload for its kind through
 * payloadOf(), so text stays put while the island crossfades to another page.
 */
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createBinding, createComputed, type Accessor } from "ags"
import { island, payloadOf } from "../../lib/island"
import { now } from "../../lib/clock"
import { formatCountdown, formatPercent, formatTime } from "../../lib/format"
import { markdownToPango } from "../../lib/markdown"
import { setImageSource } from "../../lib/icons"
import { config } from "../../lib/config"
import { battery, network, mpris, notifd } from "../../lib/services"
import { networkIcon } from "../bar/StatusArea"
import { cancelTimer } from "../../lib/timers"
import { answerConfirmation } from "../../lib/assistant-session"
import type { MediaPayload } from "../../lib/island-queue"

const { START, END, CENTER } = Gtk.Align
const VERTICAL = Gtk.Orientation.VERTICAL

/** Image whose source (path or icon name) follows an accessor. */
function DynamicImage(props: {
  source: Accessor<string>
  fallback: string
  pixelSize: number
  class?: string
}) {
  return (
    <image
      class={props.class ?? ""}
      pixelSize={props.pixelSize}
      overflow={Gtk.Overflow.HIDDEN}
      $={(self) => {
        setImageSource(self, props.source.peek(), props.fallback)
        props.source.subscribe(() => setImageSource(self, props.source.peek(), props.fallback))
      }}
    />
  )
}

function Page(props: { name: string; class?: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <box $type="named" name={props.name} class={`island-page ${props.class ?? ""}`} valign={CENTER}>
      {props.children}
    </box>
  )
}

export function IdleCompactPage() {
  return (
    <Page name="idle-compact" class="idle-compact">
      {[]}
    </Page>
  )
}

export function IdlePage() {
  const time = createComputed(() => formatTime(new Date(now()), config().bar.clock24h))
  const name = createComputed(() => config().assistant.name)
  return (
    <Page name="idle" class="idle">
      <image iconName="helixos-sparkle-symbolic" class="accent-icon" pixelSize={18} />
      <label class="idle-hint" label={name.as((n) => `Ask ${n}`)} hexpand xalign={0} />
      <image iconName={networkIcon()} visible={network !== null} />
      <image
        iconName={battery ? createBinding(battery, "batteryIconName") : "battery-missing-symbolic"}
        visible={battery !== null}
      />
      <label class="idle-time" label={time} />
    </Page>
  )
}

export function NotificationPage() {
  const payload = payloadOf("notification", {
    notificationId: null,
    appName: "",
    appIcon: "",
    image: "",
    summary: "",
    body: "",
    urgency: "normal",
    actions: [],
  })
  return (
    <Page name="notification" class="notification">
      <box orientation={VERTICAL} hexpand spacing={8}>
        <box spacing={12}>
          <DynamicImage
            class="notification-image"
            pixelSize={40}
            source={payload.as((p) => p.image || p.appIcon)}
            fallback="preferences-system-notifications-symbolic"
          />
          <box orientation={VERTICAL} hexpand valign={CENTER}>
            <box spacing={6}>
              <label
                class="island-caption"
                label={payload.as((p) => p.appName || "Notification")}
                xalign={0}
                hexpand
              />
              <label class="island-caption" label="now" />
            </box>
            <label
              class="island-title"
              label={payload.as((p) => p.summary)}
              xalign={0}
              ellipsize={Pango.EllipsizeMode.END}
              maxWidthChars={40}
            />
            <label
              class="island-body"
              label={payload.as((p) => p.body.replace(/<[^>]+>/g, ""))}
              visible={payload.as((p) => p.body.length > 0)}
              xalign={0}
              wrap
              lines={2}
              ellipsize={Pango.EllipsizeMode.END}
              maxWidthChars={48}
            />
          </box>
        </box>
        {/* Buttons like "Install" / "Cancel", answered right in the island. */}
        <box
          class="island-actions"
          spacing={8}
          homogeneous
          visible={payload.as((p) => p.actions.some((a) => a.id !== "default"))}
          $={(self) => {
            const render = () => {
              for (let child = self.get_first_child(); child; child = self.get_first_child())
                self.remove(child)
              const p = payload.peek()
              p.actions
                .filter((a) => a.id !== "default")
                .forEach((action, index) => {
                  const button = new Gtk.Button({
                    label: action.label,
                    cssClasses: index === 0 ? ["pill", "suggested"] : ["pill"],
                  })
                  button.connect("clicked", () => {
                    const n =
                      p.notificationId !== null ? notifd?.get_notification(p.notificationId) : null
                    n?.invoke(action.id)
                    island.dismiss(`notification:${p.notificationId}`)
                  })
                  self.append(button)
                })
            }
            render()
            payload.subscribe(render)
          }}
        />
      </box>
    </Page>
  )
}

const mediaFallback: MediaPayload = {
  title: "",
  artist: "",
  coverArt: "",
  playing: false,
  busName: "",
}

function player(busName: string) {
  return mpris?.players.find((p) => p.busName === busName) ?? null
}

export function MediaCompactPage() {
  const payload = payloadOf("media", mediaFallback)
  return (
    <Page name="media-compact" class="media-compact">
      <DynamicImage
        class="cover small"
        pixelSize={22}
        source={payload.as((p) => p.coverArt)}
        fallback="audio-x-generic-symbolic"
      />
      <box hexpand />
      <box
        class={payload.as((p) => (p.playing ? "equalizer playing" : "equalizer"))}
        spacing={2}
        valign={CENTER}
        halign={END}
      >
        <box class="bar b1" valign={END} />
        <box class="bar b2" valign={END} />
        <box class="bar b3" valign={END} />
        <box class="bar b4" valign={END} />
      </box>
    </Page>
  )
}

export function MediaPage() {
  const payload = payloadOf("media", mediaFallback)
  return (
    <Page name="media" class="media">
      <DynamicImage
        class="cover"
        pixelSize={56}
        source={payload.as((p) => p.coverArt)}
        fallback="audio-x-generic-symbolic"
      />
      <box orientation={VERTICAL} hexpand valign={CENTER}>
        <label
          class="island-title"
          label={payload.as((p) => p.title)}
          xalign={0}
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={28}
        />
        <label
          class="island-body"
          label={payload.as((p) => p.artist)}
          xalign={0}
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={28}
        />
      </box>
      <box class="media-controls" spacing={4} valign={CENTER}>
        <button class="island-button" onClicked={() => player(payload.peek().busName)?.previous()}>
          <image iconName="media-skip-backward-symbolic" />
        </button>
        <button
          class="island-button large"
          onClicked={() => player(payload.peek().busName)?.play_pause()}
        >
          <image
            iconName={payload.as((p) =>
              p.playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic",
            )}
          />
        </button>
        <button class="island-button" onClicked={() => player(payload.peek().busName)?.next()}>
          <image iconName="media-skip-forward-symbolic" />
        </button>
      </box>
    </Page>
  )
}

export function LevelPage({ kind }: { kind: "volume" | "brightness" }) {
  const payload = payloadOf(kind, { value: 0, muted: false, icon: "" })
  return (
    <Page name={kind} class={`level ${kind}`}>
      <image iconName={payload.as((p) => p.icon)} pixelSize={18} />
      <levelbar
        class="island-level"
        hexpand
        valign={CENTER}
        minValue={0}
        maxValue={1}
        value={payload.as((p) => (p.muted ? 0 : p.value))}
      />
      <label
        class="island-caption level-value"
        label={payload.as((p) => (p.muted ? "Muted" : formatPercent(p.value)))}
        widthChars={5}
        xalign={1}
      />
    </Page>
  )
}

export function BatteryPage() {
  const payload = payloadOf("battery", { percent: 0, charging: false, low: false, detail: "" })
  return (
    <Page name="battery" class="battery">
      <box orientation={VERTICAL} hexpand valign={CENTER}>
        <label
          class="island-title"
          label={payload.as((p) =>
            p.charging ? "Charging" : p.low ? "Low Battery" : "On Battery",
          )}
          xalign={0}
        />
        <label
          class="island-body"
          label={payload.as((p) => p.detail)}
          xalign={0}
          visible={payload.as((p) => p.detail.length > 0)}
        />
      </box>
      <label
        class={payload.as((p) => `battery-big ${p.charging ? "charging" : p.low ? "low" : ""}`)}
        label={payload.as((p) => formatPercent(p.percent))}
      />
      <image
        class={payload.as((p) => (p.charging ? "charging" : p.low ? "low" : ""))}
        iconName={payload.as((p) =>
          p.charging
            ? "battery-level-80-charging-symbolic"
            : p.low
              ? "battery-level-10-symbolic"
              : "battery-level-50-symbolic",
        )}
        pixelSize={26}
      />
    </Page>
  )
}

const timerFallback = { timerId: "", label: "", endsAt: 0, durationMs: 0, finished: false }

export function TimerCompactPage() {
  const payload = payloadOf("timer", timerFallback)
  const remaining = createComputed(() => formatCountdown(payload().endsAt - now()))
  return (
    <Page name="timer-compact" class="timer-compact">
      <image iconName="alarm-symbolic" class="timer-icon" pixelSize={16} />
      <box hexpand />
      <label class="timer-countdown" label={remaining} />
    </Page>
  )
}

export function TimerPage() {
  const payload = payloadOf("timer", timerFallback)
  const remaining = createComputed(() =>
    payload().finished ? "Done" : formatCountdown(payload().endsAt - now()),
  )
  const progress = createComputed(() => {
    const p = payload()
    if (p.finished || p.durationMs <= 0) return 1
    return Math.max(0, Math.min(1, 1 - (p.endsAt - now()) / p.durationMs))
  })
  return (
    <Page name="timer" class="timer">
      <button
        class="island-button destructive"
        valign={CENTER}
        onClicked={() => cancelTimer(payload.peek().timerId)}
        tooltipText="Cancel timer"
      >
        <image iconName="window-close-symbolic" />
      </button>
      <box orientation={VERTICAL} hexpand valign={CENTER}>
        <label class="island-caption" label={payload.as((p) => p.label || "Timer")} xalign={0} />
        <levelbar class="island-level timer-level" minValue={0} maxValue={1} value={progress} />
      </box>
      <label class="timer-countdown big" label={remaining} />
    </Page>
  )
}

const installFallback = { name: "", progress: 0, icon: "", status: "" }

export function InstallCompactPage() {
  const payload = payloadOf("install", installFallback)
  return (
    <Page name="install-compact" class="install-compact">
      <DynamicImage
        pixelSize={20}
        source={payload.as((p) => p.icon)}
        fallback="system-software-install-symbolic"
      />
      <box hexpand />
      <label class="island-caption" label={payload.as((p) => formatPercent(p.progress))} />
    </Page>
  )
}

export function InstallPage() {
  const payload = payloadOf("install", installFallback)
  return (
    <Page name="install" class="install">
      <DynamicImage
        pixelSize={40}
        source={payload.as((p) => p.icon)}
        fallback="system-software-install-symbolic"
      />
      <box orientation={VERTICAL} hexpand valign={CENTER}>
        <label class="island-title" label={payload.as((p) => p.name)} xalign={0} />
        <label class="island-body" label={payload.as((p) => p.status)} xalign={0} />
        <levelbar
          class="island-level"
          minValue={0}
          maxValue={1}
          value={payload.as((p) => p.progress)}
        />
      </box>
    </Page>
  )
}

export function AssistantPage() {
  const payload = payloadOf("assistant", { phase: "thinking", text: "", provider: "", tool: "" })
  const name = createComputed(() => config().assistant.name)
  const body = payload.as((p) => {
    if (p.phase === "thinking") return "<i>Thinking…</i>"
    if (p.phase === "tool") return `<i>${p.tool}…</i>`
    if (p.phase === "error") return `<span foreground="#FF6961">${markdownToPango(p.text)}</span>`
    return markdownToPango(p.text.length > 600 ? `…${p.text.slice(-600)}` : p.text)
  })
  return (
    <Page name="assistant" class="assistant">
      <box orientation={VERTICAL} hexpand spacing={6}>
        <box spacing={8}>
          <image
            iconName="helixos-sparkle-symbolic"
            class={payload.as(
              (p) => `accent-icon ${p.phase === "done" || p.phase === "error" ? "" : "pulsing"}`,
            )}
            pixelSize={18}
          />
          <label class="island-title" label={name} xalign={0} hexpand />
          <label
            class="provider-badge"
            label={payload.as((p) => p.provider)}
            visible={payload.as((p) => p.provider.length > 0)}
          />
        </box>
        <label
          class="island-body assistant-text"
          label={body}
          useMarkup
          wrap
          xalign={0}
          lines={4}
          ellipsize={Pango.EllipsizeMode.START}
          maxWidthChars={60}
        />
        <label
          class="island-caption"
          label="Click to open the conversation"
          xalign={0}
          halign={START}
        />
      </box>
    </Page>
  )
}

export function ConfirmPage() {
  const payload = payloadOf("confirm", { requestId: "", tool: "", summary: "" })
  return (
    <Page name="confirm" class="confirm">
      <box orientation={VERTICAL} hexpand spacing={8}>
        <box spacing={8}>
          <image iconName="dialog-warning-symbolic" class="warning-icon" pixelSize={20} />
          <label
            class="island-title"
            label={payload.as((p) => `Allow: ${p.tool}?`)}
            xalign={0}
            hexpand
          />
        </box>
        <label
          class="confirm-summary"
          label={payload.as((p) => p.summary)}
          xalign={0}
          wrap
          selectable
          maxWidthChars={60}
        />
        <box spacing={8} halign={END}>
          <button
            class="pill"
            label="Deny"
            onClicked={() => answerConfirmation(payload.peek().requestId, false)}
          />
          <button
            class="pill suggested"
            label="Allow"
            onClicked={() => answerConfirmation(payload.peek().requestId, true)}
          />
        </box>
      </box>
    </Page>
  )
}

export function SpacePage() {
  const payload = payloadOf("space", {
    name: "",
    accent: "",
    icon: "helixos-logo-symbolic",
    greeting: "",
  })
  return (
    <Page name="space" class="space">
      <image iconName={payload.as((p) => p.icon)} class="accent-icon" pixelSize={24} />
      <box orientation={VERTICAL} hexpand valign={CENTER}>
        <label class="island-caption" label={payload.as((p) => p.greeting)} xalign={0} />
        <label class="island-title" label={payload.as((p) => p.name)} xalign={0} />
      </box>
    </Page>
  )
}

const activityFallback = {
  app: "",
  icon: "",
  title: "",
  subtitle: "",
  progress: null as number | null,
}

/** An app's live activity, resting in the menu bar: its icon and how far along it is. */
export function ActivityCompactPage() {
  const payload = payloadOf("activity", activityFallback)
  return (
    <Page name="activity-compact" class="activity-compact">
      <DynamicImage
        pixelSize={18}
        source={payload.as((p) => p.icon || p.app)}
        fallback="emblem-synchronizing-symbolic"
      />
      <label
        class="island-caption activity-title"
        label={payload.as((p) => p.title)}
        xalign={0}
        hexpand
        ellipsize={Pango.EllipsizeMode.END}
        maxWidthChars={18}
      />
      <label
        class="island-caption"
        label={payload.as((p) => (p.progress === null ? "" : formatPercent(p.progress)))}
        visible={payload.as((p) => p.progress !== null)}
      />
      <Gtk.Spinner spinning visible={payload.as((p) => p.progress === null)} />
    </Page>
  )
}

export function ActivityPage() {
  const payload = payloadOf("activity", activityFallback)
  return (
    <Page name="activity" class="activity">
      <DynamicImage
        pixelSize={36}
        source={payload.as((p) => p.icon || p.app)}
        fallback="emblem-synchronizing-symbolic"
      />
      <box orientation={VERTICAL} hexpand valign={CENTER} spacing={2}>
        <label
          class="island-title"
          label={payload.as((p) => p.title)}
          xalign={0}
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={40}
        />
        <label
          class="island-body"
          label={payload.as((p) => p.subtitle)}
          visible={payload.as((p) => p.subtitle.length > 0)}
          xalign={0}
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={44}
        />
        <levelbar
          class="island-level"
          minValue={0}
          maxValue={1}
          value={payload.as((p) => p.progress ?? 0)}
          visible={payload.as((p) => p.progress !== null)}
        />
      </box>
    </Page>
  )
}
