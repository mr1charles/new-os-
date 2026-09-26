import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import { createBinding, createState } from "ags"
import { hyprland } from "../lib/services"
import { islandFootprint } from "../lib/island"
import { config } from "../lib/config"
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
 * The menu bar. It reserves space at the top of the screen, and keeps its middle free for the
 * Dynamic Island, which hangs from the top edge like a notch.
 */
export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      name={`bar-${gdkmonitor.connector}`}
      namespace="helixos-bar"
      class="bar"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.TOP}
      anchor={config.as((c) => (c.bar.position === "bottom" ? BOTTOM : TOP) | LEFT | RIGHT)}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={config.as((c) => c.dock.style !== "taskbar")}
    >
      <centerbox class="bar-content">
        <box $type="start" class="bar-start" spacing={2}>
          <SystemMenu />
          <ActiveApp />
        </box>
        <box $type="center" class="bar-island-slot" widthRequest={islandFootprint} />
        <box $type="end" class="bar-end" spacing={2}>
          <Tray />
          <StatusArea />
        </box>
      </centerbox>
    </window>
  )
}
