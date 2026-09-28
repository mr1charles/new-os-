/**
 * Only one shell popup (launcher, control center, notification center, assistant, app
 * switcher) is open at a time, like macOS. Opening one closes the others.
 */
import { createState } from "ags"
import { config } from "./config"
import { notify } from "./system"

export type PopupName =
  "launcher" | "control-center" | "notification-center" | "assistant" | "app-switcher"

const [openPopup, setOpenPopup] = createState<PopupName | null>(null)
export { openPopup }

/** The assistant can be turned off (Setup, Settings → Assistant): then it never opens. */
function allowed(name: PopupName): boolean {
  if (name !== "assistant" || config.peek().assistant.enabled) return true
  void notify("The assistant is off", "Turn it on in Settings → Assistant.")
  return false
}

export function showPopup(name: PopupName) {
  if (allowed(name)) setOpenPopup(name)
}

export function hidePopup(name?: PopupName) {
  if (name === undefined || openPopup.peek() === name) setOpenPopup(null)
}

export function togglePopup(name: PopupName) {
  if (openPopup.peek() === name) setOpenPopup(null)
  else if (allowed(name)) setOpenPopup(name)
}

export function isOpen(name: PopupName) {
  return openPopup.as((open) => open === name)
}

/** Launcher opens either as Spotlight (search) or Launchpad (app grid). */
export type LauncherMode = "search" | "grid"
const [launcherMode, setLauncherMode] = createState<LauncherMode>("search")
export { launcherMode }

export function openLauncher(mode: LauncherMode) {
  setLauncherMode(mode)
  showPopup("launcher")
}
