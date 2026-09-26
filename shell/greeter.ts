/**
 * NewOS login screen (greetd greeter). greetd runs it in a small Hyprland session
 * (distro/configs/greetd): `ags run --gtk 4 /usr/share/newos/shell/greeter.ts`.
 *
 * Development without greetd: `NEWOS_GREETER_PREVIEW=1 NEWOS_SPACES_BUS=session ags run --gtk 4 greeter.ts`
 * with `newos-spacesd --session` running.
 */
import app from "ags/gtk4/app"
import type Gtk from "gi://Gtk?version=4.0"
import type GObject from "gi://GObject?version=2.0"
import { createBinding, For } from "ags"
import { setupTheme } from "./lib/theme"
import { assetPath } from "./lib/icons"
import Greeter from "./widgets/Greeter"

app.start({
  instanceName: "newos-greeter",
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
