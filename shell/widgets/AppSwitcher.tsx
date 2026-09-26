import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createComputed, For } from "ags"
import PopupWindow from "./PopupWindow"
import { commitSwitcher, cycleSwitcher, selectSwitcher, selected, windows } from "../lib/switcher"
import { appList, toDockApp } from "../lib/apps"
import { matchApp } from "../lib/dock-model"
import { setImageSource } from "../lib/icons"

function iconFor(windowClass: string) {
  const app = matchApp(
    { address: "", class: windowClass, initialClass: windowClass, title: "", focusHistoryId: 0 },
    appList.peek().map(toDockApp),
  )
  return app?.iconName || windowClass.toLowerCase()
}

const SUPER_KEYS = [Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R]

/** Super+Tab: hold Super, press Tab to move, release Super to switch. */
export default function AppSwitcher() {
  return (
    <PopupWindow
      name="app-switcher"
      namespace="helixos-app-switcher"
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      onKeyPressed={(keyval, state) => {
        if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_Right) {
          cycleSwitcher((state & Gdk.ModifierType.SHIFT_MASK) !== 0 ? -1 : 1)
          return true
        }
        if (keyval === Gdk.KEY_ISO_Left_Tab || keyval === Gdk.KEY_Left) {
          cycleSwitcher(-1)
          return true
        }
        if (keyval === Gdk.KEY_Return) {
          commitSwitcher()
          return true
        }
        return false
      }}
      onKeyReleased={(keyval) => {
        if (SUPER_KEYS.includes(keyval)) commitSwitcher()
      }}
    >
      <box class="app-switcher panel" spacing={8}>
        <For each={windows}>
          {(client, index) => (
            <button
              class={createComputed(() =>
                selected() === index() ? "switcher-item selected" : "switcher-item",
              )}
              onClicked={() => {
                selectSwitcher(index.peek())
                commitSwitcher()
              }}
            >
              <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
                <image
                  pixelSize={72}
                  $={(self) =>
                    setImageSource(self, iconFor(client.class), "application-x-executable")
                  }
                />
                <label
                  label={client.title}
                  maxWidthChars={14}
                  ellipsize={Pango.EllipsizeMode.END}
                />
              </box>
            </button>
          )}
        </For>
      </box>
    </PopupWindow>
  )
}
