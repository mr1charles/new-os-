/**
 * Installed applications (desktop entries) with live reload when apps are installed or
 * removed, plus adapters for the dock and launcher models.
 */
import AstalApps from "gi://AstalApps"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import { createState } from "ags"
import { matchApp, type DockApp } from "./dock-model"
import type { SearchableApp } from "./search"

export const apps = new AstalApps.Apps({
  nameMultiplier: 2,
  entryMultiplier: 0.05,
  executableMultiplier: 0.05,
  descriptionMultiplier: 0.1,
  keywordsMultiplier: 0.5,
  minScore: 0.4,
})

const [appList, setAppList] = createState<AstalApps.Application[]>(apps.list)
export { appList }

let reloadSource: number | null = null

/** Debounced reload: package installs touch many files at once. */
export function reloadApps() {
  if (reloadSource !== null) return
  reloadSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
    reloadSource = null
    apps.reload()
    setAppList(apps.list)
    return GLib.SOURCE_REMOVE
  })
}

const APP_DIRS = [
  ...GLib.get_system_data_dirs().map((d) => GLib.build_filenamev([d, "applications"])),
  GLib.build_filenamev([GLib.get_user_data_dir(), "applications"]),
  "/var/lib/flatpak/exports/share/applications",
  GLib.build_filenamev([GLib.get_user_data_dir(), "flatpak", "exports", "share", "applications"]),
]

export const appMonitors: Gio.FileMonitor[] = []
for (const dir of new Set(APP_DIRS)) {
  if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) continue
  try {
    const monitor = Gio.File.new_for_path(dir).monitor_directory(Gio.FileMonitorFlags.NONE, null)
    monitor.connect("changed", reloadApps)
    appMonitors.push(monitor)
  } catch (error) {
    console.warn(`newos: cannot watch ${dir}: ${error}`)
  }
}

export function toDockApp(app: AstalApps.Application): DockApp {
  return {
    entry: app.entry,
    name: app.name,
    iconName: app.iconName ?? "",
    wmClass: app.wmClass ?? "",
    executable: app.executable ?? "",
  }
}

export function toSearchable(app: AstalApps.Application): SearchableApp {
  return {
    entry: app.entry,
    name: app.name,
    description: app.description ?? "",
    keywords: app.keywords ?? [],
    iconName: app.iconName ?? "",
    frequency: app.frequency,
  }
}

export function findApplication(entry: string): AstalApps.Application | null {
  const wanted = entry.replace(/\.desktop$/, "").toLowerCase()
  return (
    appList.peek().find((a) => a.entry.replace(/\.desktop$/, "").toLowerCase() === wanted) ?? null
  )
}

/** Launch by desktop id. Returns false when the app is not installed. */
export function launchEntry(entry: string): boolean {
  const app = findApplication(entry)
  if (!app) return false
  return app.launch()
}

/** Friendly app name for a window class, for the menu bar's active app title. */
export function appNameForClass(windowClass: string): string {
  if (!windowClass) return ""
  const match = matchApp(
    { address: "", class: windowClass, initialClass: windowClass, title: "", focusHistoryId: 0 },
    appList.peek().map(toDockApp),
  )
  if (match) return match.name
  const last = windowClass.split(".").pop() ?? windowClass
  return last.charAt(0).toUpperCase() + last.slice(1)
}
