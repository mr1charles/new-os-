/** Session and power actions, launching helpers, clipboard and notifications. */
import GLib from "gi://GLib?version=2.0"
import { execAsync } from "ags/process"
import { hyprland } from "./services"
import { launchEntry } from "./apps"

function run(argv: string[]) {
  return execAsync(argv).catch((error) => {
    console.warn(`newos: ${argv.join(" ")} failed: ${error}`)
    return ""
  })
}

/** Start a program detached from the shell so it survives shell restarts. */
export function spawn(argv: string[]) {
  if (hyprland) {
    hyprland.dispatch("exec", argv.map((a) => GLib.shell_quote(a)).join(" "))
  } else {
    GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null)
  }
}

export function hasProgram(name: string): boolean {
  return GLib.find_program_in_path(name) !== null
}

export const suspend = () => run(["systemctl", "suspend"])
export const restart = () => run(["systemctl", "reboot"])
export const shutdown = () => run(["systemctl", "poweroff"])
export const logOut = () =>
  hyprland ? hyprland.dispatch("exit", "") : run(["loginctl", "terminate-session", "self"])

export function notify(summary: string, body = "", icon = "newos-logo-symbolic") {
  return run(["notify-send", "--app-name=NewOS", `--icon=${icon}`, summary, body])
}

export function openUrl(url: string) {
  spawn(["xdg-open", url])
}

export function copyToClipboard(text: string) {
  return run(["wl-copy", "--", text])
}

/** Open the Settings app, optionally on a page (apps/settings, milestone 3). */
export function openSettings(page?: string) {
  if (hasProgram("newos-settings")) {
    spawn(page ? ["newos-settings", "--page", page] : ["newos-settings"])
  } else if (!launchEntry("newos-settings")) {
    notify("Settings is not installed yet", "The Settings app ships in milestone 3 of NewOS.")
  }
}

export function openApp(entry: string, fallbackArgv?: string[]) {
  if (launchEntry(entry)) return
  if (fallbackArgv && hasProgram(fallbackArgv[0]!)) spawn(fallbackArgv)
  else notify("App not installed", `${entry} is not installed on this system.`)
}

export function playSound(id: string) {
  if (hasProgram("canberra-gtk-play")) run(["canberra-gtk-play", "-i", id])
}
