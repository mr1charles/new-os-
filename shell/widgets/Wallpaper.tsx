import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import { createComputed } from "ags"
import { config } from "../lib/config"
import { theme } from "../lib/theme"
import { assetPath } from "../lib/icons"

/** Wallpaper follows the theme: a light and a dark picture, like macOS dynamic wallpapers. */
export const wallpaperPath = createComputed(() => {
  const appearance = config().appearance
  const custom = theme() === "dark" ? appearance.wallpaperDark : appearance.wallpaperLight
  if (custom && GLib.file_test(custom, GLib.FileTest.EXISTS)) return custom
  return assetPath("wallpapers", theme() === "dark" ? "newos-dark.svg" : "newos-light.svg")
})

export default function Wallpaper({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      visible
      name={`wallpaper-${gdkmonitor.connector}`}
      namespace="newos-wallpaper"
      class="wallpaper-window"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.BACKGROUND}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
    >
      <Gtk.Picture
        class="wallpaper"
        hexpand
        vexpand
        canShrink
        contentFit={Gtk.ContentFit.COVER}
        file={wallpaperPath.as((path) => Gio.File.new_for_path(path))}
      />
    </window>
  )
}
