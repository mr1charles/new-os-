/**
 * Only one shell popup (launcher, control center, notification center, assistant, app
 * switcher) is open at a time, like macOS. Opening one closes the others.
 */
import { createState } from "ags"

export type PopupName =
  "launcher" | "control-center" | "notification-center" | "assistant" | "app-switcher"

const [openPopup, setOpenPopup] = createState<PopupName | null>(null)
export { openPopup }

export function showPopup(name: PopupName) {
  setOpenPopup(name)
}

export function hidePopup(name?: PopupName) {
  if (name === undefined || openPopup.peek() === name) setOpenPopup(null)
}

export function togglePopup(name: PopupName) {
  setOpenPopup(openPopup.peek() === name ? null : name)
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
