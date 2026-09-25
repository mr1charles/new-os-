import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { createComputed } from "ags"
import { current, island, page, setHovered, size } from "../../lib/island"
import { showPopup } from "../../lib/popups"
import { mpris, notifd } from "../../lib/services"
import {
  AssistantPage,
  BatteryPage,
  ConfirmPage,
  IdleCompactPage,
  IdlePage,
  InstallCompactPage,
  InstallPage,
  LevelPage,
  MediaCompactPage,
  MediaPage,
  NotificationPage,
  SpacePage,
  TimerCompactPage,
  TimerPage,
} from "./views"

/** What clicking the island does, depending on what it shows. */
function activate() {
  const activity = current.peek()
  if (!activity) {
    showPopup("assistant")
    return
  }
  switch (activity.kind) {
    case "notification": {
      const id = activity.payload.notificationId
      const n = id !== null ? notifd?.get_notification(id) : null
      const action = n?.actions.find((a) => a.id === "default")
      if (n && action) n.invoke(action.id)
      else showPopup("notification-center")
      island.dismiss(activity.id)
      break
    }
    case "media":
      mpris?.players.find((p) => p.busName === activity.payload.busName)?.raise()
      break
    case "volume":
    case "brightness":
    case "battery":
      showPopup("control-center")
      island.dismiss(activity.id)
      break
    case "assistant":
      showPopup("assistant")
      island.dismiss(activity.id)
      break
    case "space":
      island.dismiss(activity.id)
      break
    default:
      break
  }
}

/**
 * The Dynamic Island: a black pill at the top center that morphs to show what is going on.
 * Sizes animate through CSS transitions on min-width/min-height; content crossfades.
 */
export default function Island() {
  const cls = createComputed(() => `island ${size()} kind-${current()?.kind ?? "idle"}`)
  return (
    <window
      visible
      name="island"
      namespace="newos-island"
      class="island-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      anchor={Astal.WindowAnchor.TOP}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      marginTop={4}
    >
      <box class={cls} halign={Gtk.Align.CENTER} valign={Gtk.Align.START}>
        <Gtk.EventControllerMotion
          onEnter={() => setHovered(true)}
          onLeave={() => setHovered(false)}
        />
        <Gtk.GestureClick onReleased={activate} />
        <stack
          class="island-stack"
          hexpand
          transitionType={Gtk.StackTransitionType.CROSSFADE}
          transitionDuration={220}
          interpolateSize
          hhomogeneous={false}
          vhomogeneous={false}
          visibleChildName={page}
        >
          <IdleCompactPage />
          <IdlePage />
          <NotificationPage />
          <MediaCompactPage />
          <MediaPage />
          <LevelPage kind="volume" />
          <LevelPage kind="brightness" />
          <BatteryPage />
          <TimerCompactPage />
          <TimerPage />
          <InstallCompactPage />
          <InstallPage />
          <AssistantPage />
          <ConfirmPage />
          <SpacePage />
        </stack>
      </box>
    </window>
  )
}
