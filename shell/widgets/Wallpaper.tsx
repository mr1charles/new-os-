import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import { createComputed } from "ags"
import { config } from "../lib/config"
import { theme } from "../lib/theme"
import { assetPath } from "../lib/icons"
import { openSettings } from "../lib/system"
import { editWidgets } from "./DesktopWidgets"

/** Wallpaper follows the theme: a light and a dark picture, like macOS dynamic wallpapers. */
export const wallpaperPath = createComputed(() => {
  const appearance = config().appearance
  const chosen = theme() === "dark" ? appearance.wallpaperDark : appearance.wallpaperLight
  // "builtin:<file>" names one of HelixOS's own wallpapers wherever they are installed.
  const custom = chosen.startsWith("builtin:")
    ? assetPath("wallpapers", GLib.path_get_basename(chosen.slice("builtin:".length)))
    : chosen
  if (custom && GLib.file_test(custom, GLib.FileTest.EXISTS)) return custom
  return assetPath("wallpapers", theme() === "dark" ? "helixos-dark.svg" : "helixos-light.svg")
})

/** Right-click on the desktop: widgets, wallpaper, and the look. */
function desktopMenu(picture: Gtk.Widget) {
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
  popover.set_parent(picture)
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
  picture.add_controller(click)
}

export default function Wallpaper({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      name={`wallpaper-${gdkmonitor.connector}`}
      namespace="helixos-wallpaper"
      class="wallpaper-window"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.BACKGROUND}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible
    >
      <Gtk.Picture
        class="wallpaper"
        hexpand
        vexpand
        canShrink
        contentFit={Gtk.ContentFit.COVER}
        file={wallpaperPath.as((path) => Gio.File.new_for_path(path))}
        $={desktopMenu}
      />
    </window>
  )
}
