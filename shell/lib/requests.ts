/**
 * Command interface for keybindings and scripts:
 *
 *   ags request -i newos <command> [args]
 *
 * Hyprland binds (shell/hypr/hyprland.conf) call these for Super+Space, volume keys, etc.
 */
import { hidePopup, openLauncher, showPopup, togglePopup, type PopupName } from "./popups"
import { stepVolume, toggleMute } from "./audio"
import { stepBrightness } from "./brightness"
import { showBrightnessOsd, showVolumeOsd } from "./island-sources"
import { updateConfig, config } from "./config"
import { island } from "./island"
import { cycleSwitcher } from "./switcher"
import { send } from "./assistant-session"
import { startTimer } from "./timers"
import { parseDuration } from "./format"

const HELP = `NewOS shell commands:
  launcher | launchpad            open Spotlight search or the app grid
  assistant [prompt...]           open the assistant (and ask something)
  control-center | notifications  toggle a panel
  switcher next|prev              app switcher (Super+Tab)
  volume up|down|mute             change volume and show it in the island
  brightness up|down              change screen brightness
  theme dark|light|auto|toggle    change appearance
  dnd on|off|toggle               Do Not Disturb
  timer <duration> [label]        start a timer, e.g. "timer 10m tea"
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

function togglePopupMode(mode: "search" | "grid") {
  openLauncher(mode)
}
