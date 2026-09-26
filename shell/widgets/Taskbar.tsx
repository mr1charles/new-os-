import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import { createState, For } from "ags"
import { config } from "../lib/config"
import { openLauncher } from "../lib/popups"
import { DockIcon, dockItems } from "./Dock"
import StatusArea from "./bar/StatusArea"
import Tray from "./bar/Tray"

/**
 * The taskbar (Settings → Desktop & Dock → Style: Taskbar, or the "Windows" look): a
 * full-width strip with Start and search, the dock's apps in the middle, and the tray, status
 * icons, and clock on the right. It replaces both the Dock and the menu bar.
 */
export default function Taskbar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const [hovered, setHovered] = createState<number | null>(null)
  return (
    <window
      name={`taskbar-${gdkmonitor.connector}`}
      namespace="newos-taskbar"
      class="taskbar-window"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.TOP}
      anchor={BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      keymode={Astal.Keymode.NONE}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={config.as((c) => c.dock.style === "taskbar")}
    >
      <centerbox class="taskbar">
        <box $type="start" spacing={2}>
          <button
            class="taskbar-button taskbar-start"
            tooltipText="Start"
            onClicked={() => openLauncher("grid")}
          >
            <image iconName="newos-launchpad" pixelSize={24} />
          </button>
          <button
            class="taskbar-button"
            tooltipText="Search"
            onClicked={() => openLauncher("search")}
          >
            <image iconName="system-search-symbolic" pixelSize={18} />
          </button>
        </box>
        <box $type="center" class="taskbar-apps dock">
          <Gtk.EventControllerMotion onLeave={() => setHovered(null)} />
          <For each={dockItems} id={(item) => item.key}>
            {(item, index) => (
              <DockIcon item={item} index={index} hovered={hovered} setHovered={setHovered} />
            )}
          </For>
        </box>
        <box $type="end" class="taskbar-end" spacing={2}>
          <Tray />
          <StatusArea />
        </box>
      </centerbox>
    </window>
  )
}
