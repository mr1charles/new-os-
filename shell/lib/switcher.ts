/**
 * App switcher (Super+Tab) state. Windows are ordered by focus history; each press moves the
 * selection and releasing Super focuses the selected window.
 */
import { createState } from "ags"
import type { AstalHyprland } from "./services"
import { hyprland } from "./services"
import { openPopup, showPopup, hidePopup } from "./popups"

const [windows, setWindows] = createState<AstalHyprland.Client[]>([])
const [selected, setSelected] = createState(0)
export { windows, selected }

export function cycleSwitcher(direction: 1 | -1) {
  if (!hyprland) return
  if (openPopup.peek() !== "app-switcher") {
    const list = [...hyprland.clients]
      .filter((c) => c.mapped && !c.hidden)
      .sort((a, b) => a.focusHistoryId - b.focusHistoryId)
    if (list.length === 0) return
    setWindows(list)
    // Start on the previous window, like macOS Cmd+Tab.
    setSelected(list.length > 1 ? (direction === 1 ? 1 : list.length - 1) : 0)
    showPopup("app-switcher")
    return
  }
  const count = windows.peek().length
  if (count === 0) return
  setSelected((index) => (index + direction + count) % count)
}

export function commitSwitcher() {
  const client = windows.peek()[selected.peek()]
  hidePopup("app-switcher")
  if (!client) return
  if (client.workspace && client.workspace.id !== hyprland?.focusedWorkspace?.id)
    client.workspace.focus()
  client.focus()
}

export function selectSwitcher(index: number) {
  setSelected(index)
}
