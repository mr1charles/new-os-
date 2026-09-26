/**
 * NewOS shell entry point (AGS v3, GTK4).
 *
 *   ags run --gtk 4 app.ts          # development
 *   ags request -i newos help       # list commands for keybindings
 */
import app from "ags/gtk4/app"
import type Gtk from "gi://Gtk?version=4.0"
import type GObject from "gi://GObject?version=2.0"
import { createBinding, For } from "ags"
import { handleRequest } from "./lib/requests"
import { setupTheme } from "./lib/theme"
import { setupIslandSources } from "./lib/island-sources"
import { setupNightShift } from "./lib/nightshift"
import { assetPath } from "./lib/icons"
import Bar from "./widgets/Bar"
import Dock from "./widgets/Dock"
import Taskbar from "./widgets/Taskbar"
import Wallpaper from "./widgets/Wallpaper"
import Island from "./widgets/island/Island"
import Launcher from "./widgets/Launcher"
import ControlCenter from "./widgets/ControlCenter"
import NotificationCenter from "./widgets/NotificationCenter"
import AppSwitcher from "./widgets/AppSwitcher"
import AssistantPanel from "./widgets/AssistantPanel"
import { followLogind } from "./widgets/LockScreen"
import { serveIsland } from "./lib/island-service"
import { setupWindowManagement } from "./lib/windows"

const destroy = (window: GObject.Object) => (window as Gtk.Window).destroy()

app.start({
  instanceName: "newos",
  icons: assetPath("icons"),
  requestHandler: handleRequest,
  main() {
    setupTheme()
    setupIslandSources()
    setupNightShift()

    const monitors = createBinding(app, "monitors")

    For({
      each: monitors,
      cleanup: destroy,
      children: (monitor) => Wallpaper({ gdkmonitor: monitor }),
    })
    For({ each: monitors, cleanup: destroy, children: (monitor) => Bar({ gdkmonitor: monitor }) })
    For({ each: monitors, cleanup: destroy, children: (monitor) => Dock({ gdkmonitor: monitor }) })
    For({
      each: monitors,
      cleanup: destroy,
      children: (monitor) => Taskbar({ gdkmonitor: monitor }),
    })

    Island()
    Launcher()
    ControlCenter()
    NotificationCenter()
    AppSwitcher()
    AssistantPanel()
    followLogind()
    serveIsland()
    setupWindowManagement()
  },
})
