/**
 * HelixOS login screen (greetd greeter). greetd runs it in a small Hyprland session
 * (distro/configs/greetd): `ags run --gtk 4 /usr/share/helixos/shell/greeter.ts`.
 *
 * Development without greetd: `HELIXOS_GREETER_PREVIEW=1 HELIXOS_SPACES_BUS=session ags run --gtk 4 greeter.ts`
 * with `helixos-spacesd --session` running.
 */
import app from "ags/gtk4/app"
import type Gtk from "gi://Gtk?version=4.0"
import type GObject from "gi://GObject?version=2.0"
import { createBinding, For } from "ags"
import { setupTheme } from "./lib/theme"
import { assetPath } from "./lib/icons"
import Greeter from "./widgets/Greeter"

app.start({
  instanceName: "helixos-greeter",
  icons: assetPath("icons"),
  main() {
    setupTheme()
    const monitors = createBinding(app, "monitors")
    For({
      each: monitors,
      cleanup: (window: GObject.Object) => (window as Gtk.Window).destroy(),
      children: (monitor) =>
        Greeter({ gdkmonitor: monitor, primary: monitor === app.get_monitors()[0] }),
    })
  },
})
