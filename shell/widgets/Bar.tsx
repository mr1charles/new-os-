import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import { createBinding, createState } from "ags"
import { hyprland } from "../lib/services"
import { appNameForClass } from "../lib/apps"
import SystemMenu from "./bar/SystemMenu"
import StatusArea from "./bar/StatusArea"
import Tray from "./bar/Tray"

function ActiveApp() {
  const title = hyprland
    ? createBinding(hyprland, "focusedClient").as((client) =>
        client ? appNameForClass(client.class) : "Desktop",
      )
    : createState("Desktop")[0]
  return <label class="active-app" label={title} />
}

/**
 * The menu bar. It reserves space at the top of the screen; the Dynamic Island floats over
 * its center like the notch on a MacBook.
 */
export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      visible
      name={`bar-${gdkmonitor.connector}`}
      namespace="newos-bar"
      class="bar"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.TOP}
      anchor={TOP | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
    >
      <centerbox class="bar-content">
        <box $type="start" class="bar-start" spacing={2}>
          <SystemMenu />
          <ActiveApp />
        </box>
        <box $type="end" class="bar-end" spacing={2}>
          <Tray />
          <StatusArea />
        </box>
      </centerbox>
    </window>
  )
}
