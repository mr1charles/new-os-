/** Right-click on the desktop: widgets, wallpaper, and the look. */
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import { editWidgets } from "./widget-edit"
import { openSettings } from "./system"

/** Show the desktop menu when `widget` is right-clicked on its empty space. */
export function attachDesktopMenu(widget: Gtk.Widget) {
  const popover = new Gtk.Popover({ hasArrow: false, cssClasses: ["desktop-menu"] })
  const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  const item = (label: string, run: () => void) => {
    const button = new Gtk.Button({
      cssClasses: ["menu-item"],
      child: new Gtk.Label({ label, xalign: 0 }),
    })
    button.connect("clicked", () => {
      popover.popdown()
      run()
    })
    list.append(button)
  }
  item("Edit Widgets…", () => editWidgets(true))
  item("Change Wallpaper…", () => openSettings("wallpaper"))
  item("Customize…", () => openSettings("customize"))
  popover.set_child(list)
  popover.set_parent(widget)
  const click = new Gtk.GestureClick({ button: Gdk.BUTTON_SECONDARY })
  click.connect("pressed", (_g, _n, x, y) => {
    const rect = new Gdk.Rectangle()
    rect.x = Math.round(x)
    rect.y = Math.round(y)
    rect.width = 1
    rect.height = 1
    popover.set_pointing_to(rect)
    popover.popup()
  })
  widget.add_controller(click)
  widget.connect("destroy", () => popover.unparent())
}
