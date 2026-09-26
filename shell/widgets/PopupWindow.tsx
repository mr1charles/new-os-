import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import { Accessor } from "ags"
import { hidePopup, isOpen, type PopupName } from "../lib/popups"

interface PopupWindowProps {
  name: PopupName
  namespace: string
  halign: Gtk.Align
  valign: Gtk.Align
  marginTop?: number
  marginEnd?: number
  marginBottom?: number
  /** Dim everything behind the panel (Launchpad). */
  dim?: Accessor<boolean> | boolean
  onShow?: () => void
  onKeyPressed?: (keyval: number, state: Gdk.ModifierType) => boolean
  onKeyReleased?: (keyval: number, state: Gdk.ModifierType) => void
  children: JSX.Element | JSX.Element[]
}

/**
 * Full-screen transparent overlay that hosts one panel. Clicking outside the panel or
 * pressing Escape closes it, which is how macOS menus and Spotlight behave.
 */
export default function PopupWindow(props: PopupWindowProps) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  let panel: Gtk.Box | null = null

  const dimClass =
    props.dim instanceof Accessor
      ? props.dim.as((d) => (d ? "popup-window dim" : "popup-window"))
      : props.dim
        ? "popup-window dim"
        : "popup-window"

  const onPressed = (gesture: Gtk.GestureClick, _presses: number, x: number, y: number) => {
    const root = gesture.get_widget()
    if (!panel || !root) return
    const [ok, rect] = panel.compute_bounds(root)
    const inside =
      ok &&
      x >= rect.get_x() &&
      x <= rect.get_x() + rect.get_width() &&
      y >= rect.get_y() &&
      y <= rect.get_y() + rect.get_height()
    if (!inside) hidePopup(props.name)
  }

  return (
    <window
      name={props.name}
      namespace={props.namespace}
      class={dimClass}
      application={app}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      onNotifyVisible={(self) => {
        if (self.visible) props.onShow?.()
      }}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={isOpen(props.name)}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_controller, keyval, _code, state) => {
          if (keyval === Gdk.KEY_Escape) {
            hidePopup(props.name)
            return true
          }
          return props.onKeyPressed?.(keyval, state) ?? false
        }}
        onKeyReleased={(_controller, keyval, _code, state) => props.onKeyReleased?.(keyval, state)}
      />
      <Gtk.GestureClick onPressed={onPressed} />
      <box
        $={(self) => (panel = self)}
        class="popup-slot"
        halign={props.halign}
        valign={props.valign}
        marginTop={props.marginTop ?? 0}
        marginEnd={props.marginEnd ?? 0}
        marginBottom={props.marginBottom ?? 0}
      >
        {props.children}
      </box>
    </window>
  )
}
