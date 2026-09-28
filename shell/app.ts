/**
 * HelixOS shell entry point (AGS v3, GTK4).
 *
 *   ags run --gtk 4 app.ts          # development
 *   ags request -i helixos help       # list commands for keybindings
 */
import app from "ags/gtk4/app"
import GLib from "gi://GLib?version=2.0"
import { config } from "./lib/config"
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
import DesktopWidgets, { WidgetGallery } from "./widgets/DesktopWidgets"
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
import { playStartup } from "./widgets/Startup"
import { shouldPlayAtLogin } from "./lib/startup"
import { hasProgram, spawn } from "./lib/system"

const destroy = (window: GObject.Object) => (window as Gtk.Window).destroy()

app.start({
  instanceName: "helixos",
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
    For({
      each: monitors,
      cleanup: destroy,
      children: (monitor) => DesktopWidgets({ gdkmonitor: monitor }),
    })
    For({ each: monitors, cleanup: destroy, children: (monitor) => Bar({ gdkmonitor: monitor }) })
    For({ each: monitors, cleanup: destroy, children: (monitor) => Dock({ gdkmonitor: monitor }) })
    For({
      each: monitors,
      cleanup: destroy,
      children: (monitor) => Taskbar({ gdkmonitor: monitor }),
    })

    Island()
    WidgetGallery()
    Launcher()
    ControlCenter()
    NotificationCenter()
    AppSwitcher()
    AssistantPanel()
    followLogind()
    serveIsland()
    setupWindowManagement()
    startupAtLogin()
    firstRunSetup()
  },
})

/** The startup animation once per login (the login screen plays it after a real boot). */
function startupAtLogin() {
  const flag = GLib.build_filenamev([GLib.get_user_runtime_dir(), "helixos", "startup-played"])
  const play = shouldPlayAtLogin({
    enabled: config.peek().appearance.startupAnimation,
    alreadyPlayed: GLib.file_test(flag, GLib.FileTest.EXISTS),
    fromGreeter: GLib.getenv("HELIXOS_FROM_GREETER") === "1",
  })
  if (!play) return
  GLib.mkdir_with_parents(GLib.path_get_dirname(flag), 0o700)
  GLib.file_set_contents(flag, "")
  for (const monitor of app.get_monitors()) playStartup(monitor)
}

/**
 * The first time HelixOS starts: Setup (language, look, assistant, browser), full screen, after
 * the startup animation. It sets `setup.done` when finished or skipped.
 */
function firstRunSetup() {
  if (config.peek().setup.done || !hasProgram("helixos-settings")) return
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3300, () => {
    if (!config.peek().setup.done) spawn(["helixos-settings", "--setup"])
    return GLib.SOURCE_REMOVE
  })
}
