/**
 * Command interface for keybindings and scripts:
 *
 *   ags request -i helixos <command> [args]
 *
 * Hyprland binds (shell/hypr/hyprland.conf) call these for Super+Space, volume keys, etc.
 */
import { lockSession } from "../widgets/LockScreen"
import { hidePopup, openLauncher, showPopup, togglePopup, type PopupName } from "./popups"
import { stepVolume, toggleMute } from "./audio"
import { stepBrightness } from "./brightness"
import { showBrightnessOsd, showVolumeOsd } from "./island-sources"
import { updateConfig, config } from "./config"
import type { ShellConfig } from "@helixos/sdk/settings-schema"
import { island } from "./island"
import { cycleSwitcher } from "./switcher"
import { send } from "./assistant-session"
import { startTimer } from "./timers"
import { parseDuration } from "./format"
import { arrangeWorkspace, snap } from "./windows"
import app from "ags/gtk4/app"
import { playStartup } from "../widgets/Startup"
import { editWidgets } from "../widgets/DesktopWidgets"
import { diffConfig, patchConfig, PRESETS } from "@helixos/sdk/customize"

const HELP = `HelixOS shell commands:
  launcher | launchpad            open Spotlight search or the app grid
  assistant [prompt...]           open the assistant (and ask something)
  control-center | notifications  toggle a panel
  switcher next|prev              app switcher (Super+Tab)
  volume up|down|mute             change volume and show it in the island
  brightness up|down              change screen brightness
  theme dark|light|auto|toggle    change appearance
  dnd on|off|toggle               Do Not Disturb
  lock                            Lock the screen
  timer <duration> [label]        start a timer, e.g. "timer 10m tea"
  snap left|right|up|down|<zone>  snap the window (halves, quarters, thirds, maximize)
  arrange                         tile every window on the desktop by how many there are
  look preset <id>|apply <json>|undo   change the look (presets: ${PRESETS.map((p) => p.id).join(", ")})
  widgets edit|done               add and remove desktop widgets
  startup                         play the startup animation
  island dismiss                  clear the island
  close                           close any open panel`

const PANELS: Record<string, PopupName> = {
  "control-center": "control-center",
  notifications: "notification-center",
  "notification-center": "notification-center",
}

export function handleRequest(argv: string[], respond: (response: string) => void) {
  // AGS passes the program name first when invoked from the CLI.
  const args = argv[0] === "ags" || argv[0]?.endsWith("/ags") ? argv.slice(1) : argv
  const [command = "help", ...rest] = args
  try {
    respond(dispatch(command, rest))
  } catch (error) {
    respond(`error: ${error}`)
  }
}

function dispatch(command: string, args: string[]): string {
  switch (command) {
    case "lock":
      lockSession()
      return "ok"
    case "launcher":
      togglePopupMode("search")
      return "ok"
    case "launchpad":
      togglePopupMode("grid")
      return "ok"
    case "assistant": {
      const prompt = args.join(" ").trim()
      showPopup("assistant")
      if (prompt) send(prompt)
      return "ok"
    }
    case "control-center":
    case "notifications":
    case "notification-center":
      togglePopup(PANELS[command]!)
      return "ok"
    case "switcher":
      cycleSwitcher(args[0] === "prev" ? -1 : 1)
      return "ok"
    case "close":
      hidePopup()
      return "ok"
    case "volume":
      if (args[0] === "up") stepVolume(0.05)
      else if (args[0] === "down") stepVolume(-0.05)
      else if (args[0] === "mute") toggleMute()
      else return "usage: volume up|down|mute"
      showVolumeOsd()
      return "ok"
    case "brightness":
      if (args[0] === "up") stepBrightness(0.05).then(showBrightnessOsd)
      else if (args[0] === "down") stepBrightness(-0.05).then(showBrightnessOsd)
      else return "usage: brightness up|down"
      return "ok"
    case "theme": {
      const value = args[0]
      if (value === "toggle") {
        updateConfig((c) => (c.appearance.theme = c.appearance.theme === "dark" ? "light" : "dark"))
      } else if (value === "dark" || value === "light" || value === "auto") {
        updateConfig((c) => (c.appearance.theme = value))
      } else {
        return "usage: theme dark|light|auto|toggle"
      }
      return config.peek().appearance.theme
    }
    case "dnd": {
      const value = args[0]
      const current = config.peek().notifications.doNotDisturb
      const next = value === "on" ? true : value === "off" ? false : !current
      updateConfig((c) => (c.notifications.doNotDisturb = next))
      return next ? "on" : "off"
    }
    case "timer": {
      const duration = parseDuration(args[0] ?? "")
      if (duration === null) return "usage: timer <duration> [label], e.g. timer 10m tea"
      return startTimer(duration, args.slice(1).join(" "))
    }
    case "widgets":
      if (args[0] === "edit") editWidgets(true)
      else if (args[0] === "done") editWidgets(false)
      else return "usage: widgets edit|done"
      return "ok"
    case "startup":
      for (const monitor of app.get_monitors()) playStartup(monitor)
      return "ok"
    case "look":
      return look(args)
    case "snap":
      return snap(args[0] ?? "")
    case "arrange":
      return arrangeWorkspace()
    case "island":
      if (args[0] === "dismiss") {
        const current = island.current()
        if (current) island.dismiss(current.id)
        return "ok"
      }
      return "usage: island dismiss"
    case "help":
    default:
      return HELP
  }
}

let beforeLook: ShellConfig | null = null

/**
 * Change many settings at once (the assistant's change_look tool, Settings → Customize).
 * Values go through the settings schema, so only real settings with allowed values change.
 * Prints the changes as JSON.
 */
function look(args: string[]): string {
  const [action, ...rest] = args
  const current = config.peek()
  let next: ShellConfig
  if (action === "undo") {
    if (!beforeLook) return "error: nothing to undo"
    next = beforeLook
    beforeLook = null
  } else if (action === "preset") {
    const preset = PRESETS.find((p) => p.id === rest[0])
    if (!preset) return `error: unknown preset (${PRESETS.map((p) => p.id).join(", ")})`
    next = patchConfig(current, preset.patch)
    beforeLook = current
  } else if (action === "apply") {
    let patch: unknown
    try {
      patch = JSON.parse(rest.join(" "))
    } catch {
      return "error: apply needs a JSON object"
    }
    // Pinned apps and the assistant's own setup are not part of the look.
    const safe = { ...(patch as Record<string, unknown>) }
    delete safe.assistant
    next = patchConfig(current, safe)
    next.dock.pinned = current.dock.pinned
    beforeLook = current
  } else {
    return "usage: look preset <id> | look apply <json> | look undo"
  }
  const changes = diffConfig(current, next)
  if (changes.length > 0) updateConfig((draft) => Object.assign(draft, next))
  return JSON.stringify(changes)
}

function togglePopupMode(mode: "search" | "grid") {
  openLauncher(mode)
}
