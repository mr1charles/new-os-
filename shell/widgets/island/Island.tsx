import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { createComputed } from "ags"
import { current, island, islandVisible, page, setHovered, size } from "../../lib/island"
import { hyprland } from "../../lib/services"
import { showPopup } from "../../lib/popups"
import { mpris, notifd } from "../../lib/services"
import {
  ActivityCompactPage,
  ActivityPage,
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
    case "activity":
      // Bring the app that owns the activity to the front.
      if (activity.payload.app)
        hyprland?.dispatch(
          "focuswindow",
          `class:^(${activity.payload.app.replace(/[^\w.-]/g, "")})$`,
        )
      break
    default:
      break
  }
}

/**
 * The Dynamic Island: part of the menu bar, like a notch that hangs from the top edge. It
 * rests at the bar's height (the bar keeps that room free) and grows downward with a spring
 * when something happens; content crossfades. It stays compact for an app's own activity while
 * that app is in front, and hides over fullscreen apps unless something needs attention.
 */
export default function Island() {
  const cls = createComputed(() => `island ${size()} kind-${current()?.kind ?? "idle"}`)
  return (
    <window
      name="island"
      namespace="helixos-island"
      class="island-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      anchor={Astal.WindowAnchor.TOP}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      marginTop={0}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={islandVisible}
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
          <ActivityCompactPage />
          <ActivityPage />
          <AssistantPage />
          <ConfirmPage />
          <SpacePage />
        </stack>
      </box>
    </window>
  )
}
