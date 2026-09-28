/** Desktop widget edit mode (remove buttons, the gallery), shared by the desktop and requests. */
import { createState } from "ags"

const [editing, setEditing] = createState(false)
export { editing }

export function editWidgets(on: boolean = !editing.peek()) {
  setEditing(on)
}
