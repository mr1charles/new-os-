import GLib from "gi://GLib?version=2.0"
import Gtk from "gi://Gtk?version=4.0"

const INSTALLED_ASSETS = "/usr/share/helixos/shell/assets"

/** Installed assets on HelixOS, the source tree while developing. */
export function assetsDir(): string {
  if (GLib.file_test(INSTALLED_ASSETS, GLib.FileTest.IS_DIR)) return INSTALLED_ASSETS
  return GLib.build_filenamev([SRC, "assets"])
}

export function assetPath(...parts: string[]): string {
  return GLib.build_filenamev([assetsDir(), ...parts])
}

let iconTheme: Gtk.IconTheme | null = null

function hasIcon(name: string): boolean {
  iconTheme ??= Gtk.IconTheme.get_for_display(new Gtk.Image().get_display())
  return iconTheme.has_icon(name)
}

/**
 * Point an image at a notification-style source: an absolute path, a file:// URI, or an
 * icon name. Falls back to `fallback` when the source cannot be shown.
 */
export function setImageSource(
  image: Gtk.Image,
  source: string | null | undefined,
  fallback: string,
) {
  const value = source?.trim() ?? ""
  if (value.startsWith("/") || value.startsWith("file://")) {
    const path = value.replace(/^file:\/\//, "")
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
      image.set_from_file(path)
      return
    }
  }
  if (value.length > 0 && hasIcon(value)) {
    image.set_from_icon_name(value)
    return
  }
  image.set_from_icon_name(fallback)
}
