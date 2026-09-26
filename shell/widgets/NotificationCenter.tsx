import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createBinding, createComputed, createState, For, type Accessor } from "ags"
import PopupWindow from "./PopupWindow"
import { notifd, AstalNotifd } from "../lib/services"
import { config, updateConfig } from "../lib/config"
import { now } from "../lib/clock"
import { formatLongDate, formatTime, timeAgo } from "../lib/format"
import { setImageSource } from "../lib/icons"
import { runningTimers } from "../lib/timers"
import { formatCountdown } from "../lib/format"
import { groupNotifications, type NotificationGroup } from "../lib/notification-groups"

const VERTICAL = Gtk.Orientation.VERTICAL

function stripMarkup(text: string) {
  return text.replace(/<[^>]+>/g, "")
}

function NotificationCard({ notification }: { notification: AstalNotifd.Notification }) {
  const n = notification
  const actions = n.actions.filter((a) => a.id !== "default")
  const defaultAction = n.actions.find((a) => a.id === "default")
  return (
    <box
      class={`notification-card urgency-${n.urgency === AstalNotifd.Urgency.CRITICAL ? "critical" : "normal"}`}
      orientation={VERTICAL}
    >
      <Gtk.GestureClick
        onReleased={() => {
          if (defaultAction) n.invoke(defaultAction.id)
          n.dismiss()
        }}
      />
      <box spacing={8}>
        <image
          class="notification-app-icon"
          pixelSize={16}
          $={(self) =>
            setImageSource(
              self,
              n.appIcon || n.desktopEntry,
              "preferences-system-notifications-symbolic",
            )
          }
        />
        <label
          class="notification-app"
          label={(n.appName || "Notification").toUpperCase()}
          hexpand
          xalign={0}
        />
        <label class="notification-time" label={now.as((t) => timeAgo(n.time * 1000, t))} />
        <button class="notification-close" onClicked={() => n.dismiss()} tooltipText="Clear">
          <image iconName="window-close-symbolic" pixelSize={12} />
        </button>
      </box>
      <box spacing={10}>
        <box orientation={VERTICAL} hexpand>
          <label
            class="notification-summary"
            label={n.summary}
            xalign={0}
            wrap
            ellipsize={Pango.EllipsizeMode.END}
            lines={2}
            maxWidthChars={36}
          />
          <label
            class="notification-body"
            label={stripMarkup(n.body)}
            visible={n.body.length > 0}
            xalign={0}
            wrap
            lines={4}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={40}
          />
        </box>
        <image
          class="notification-image"
          pixelSize={44}
          visible={n.image.length > 0}
          overflow={Gtk.Overflow.HIDDEN}
          $={(self) => setImageSource(self, n.image, "image-x-generic-symbolic")}
        />
      </box>
      <box class="notification-actions" spacing={6} homogeneous visible={actions.length > 0}>
        {actions.map((action) => (
          <button class="pill" label={action.label} onClicked={() => n.invoke(action.id)} />
        ))}
      </box>
    </box>
  )
}

type Group = NotificationGroup<AstalNotifd.Notification>

/**
 * One app's notifications as a stack: the newest shows, the rest fold out on "Show N More".
 * The group is looked up by key so it stays the same widget while notifications come and go.
 */
function NotificationStack({ groups, groupKey }: { groups: Accessor<Group[]>; groupKey: string }) {
  const items = groups.as((gs) => gs.find((g) => g.key === groupKey)?.items ?? [])
  const [expanded, setExpanded] = createState(false)
  const newest = items.as((list) => list.slice(0, 1))
  const rest = items.as((list) => list.slice(1))
  return (
    <box class="nc-group" orientation={VERTICAL} spacing={6}>
      <box class="nc-group-header" spacing={6} visible={items.as((l) => l.length > 1)}>
        <label
          class="nc-group-title"
          label={items.as((l) => l[0]?.appName || "Notifications")}
          hexpand
          xalign={0}
        />
        <button
          class="pill"
          label={createComputed(() => (expanded() ? "Show Less" : `Show ${rest().length} More`))}
          onClicked={() => setExpanded(!expanded.peek())}
        />
        <button
          class="notification-close"
          tooltipText="Clear"
          onClicked={() => items.peek().forEach((n) => n.dismiss())}
        >
          <image iconName="window-close-symbolic" pixelSize={12} />
        </button>
      </box>
      <For each={newest} id={(n) => n.id}>
        {(n) => <NotificationCard notification={n} />}
      </For>
      <revealer
        revealChild={expanded}
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        transitionDuration={200}
      >
        <box orientation={VERTICAL} spacing={6}>
          <For each={rest} id={(n) => n.id}>
            {(n) => <NotificationCard notification={n} />}
          </For>
        </box>
      </revealer>
      <box class="nc-stack-edge" visible={createComputed(() => !expanded() && rest().length > 0)} />
    </box>
  )
}

function TodayHeader() {
  const time = createComputed(() => formatTime(new Date(now()), config().bar.clock24h))
  const date = now.as((t) => formatLongDate(new Date(t)))
  const timers = now.as(() =>
    runningTimers()
      .map((t) => `${t.label || "Timer"} · ${formatCountdown(t.endsAt - Date.now())}`)
      .join("\n"),
  )
  return (
    <box class="nc-today" orientation={VERTICAL} spacing={6}>
      <label class="nc-time" label={time} xalign={0} />
      <label class="nc-date" label={date} xalign={0} />
      <Gtk.Calendar class="nc-calendar" showHeading showDayNames />
      <label class="nc-timers" label={timers} visible={timers.as((t) => t.length > 0)} xalign={0} />
    </box>
  )
}

/** Notification Center: today's date and calendar, timers, and notifications stacked by app. */
export default function NotificationCenter() {
  const list = notifd ? createBinding(notifd, "notifications") : null
  const groups = list ? list.as((items) => groupNotifications(items)) : null
  const keys = groups ? groups.as((gs) => gs.map((g) => g.key)) : null
  const dnd = config.as((c) => c.notifications.doNotDisturb)

  return (
    <PopupWindow
      name="notification-center"
      namespace="newos-notification-center"
      halign={Gtk.Align.END}
      valign={Gtk.Align.FILL}
      marginTop={6}
      marginEnd={8}
      marginBottom={8}
    >
      <box class="notification-center panel" orientation={VERTICAL} spacing={10} widthRequest={380}>
        <TodayHeader />
        <box class="nc-header" spacing={6}>
          <label class="nc-title" label="Notifications" hexpand xalign={0} />
          <togglebutton
            class="flat-icon"
            active={dnd}
            tooltipText="Do Not Disturb"
            onToggled={(self) => updateConfig((c) => (c.notifications.doNotDisturb = self.active))}
          >
            <image
              iconName={dnd.as((d) =>
                d ? "weather-clear-night-symbolic" : "preferences-system-notifications-symbolic",
              )}
            />
          </togglebutton>
          <button
            class="pill"
            label="Clear All"
            visible={list ? list.as((l) => l.length > 0) : false}
            onClicked={() => notifd?.notifications.forEach((n) => n.dismiss())}
          />
        </box>
        <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
          <box orientation={VERTICAL} spacing={8}>
            {groups && keys ? (
              <For each={keys} id={(key) => key}>
                {(key) => <NotificationStack groups={groups} groupKey={key} />}
              </For>
            ) : (
              <box />
            )}
            <label
              class="nc-empty"
              label="No Notifications"
              vexpand
              valign={Gtk.Align.CENTER}
              visible={list ? list.as((l) => l.length === 0) : true}
            />
          </box>
        </scrolledwindow>
      </box>
    </PopupWindow>
  )
}
