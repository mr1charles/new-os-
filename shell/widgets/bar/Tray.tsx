import type Gtk from "gi://Gtk?version=4.0"
import type AstalTray from "gi://AstalTray"
import { createBinding, For } from "ags"
import { tray } from "../../lib/services"

/** StatusNotifierItem icons from background apps (Discord, Steam, Nextcloud, ...). */
export default function Tray() {
  if (!tray) return <box visible={false} />
  const items = createBinding(tray, "items")

  const setup = (button: Gtk.MenuButton, item: AstalTray.TrayItem) => {
    const sync = () => {
      button.set_menu_model(item.menuModel)
      button.insert_action_group("dbusmenu", item.actionGroup)
    }
    sync()
    item.connect("notify::action-group", sync)
    item.connect("notify::menu-model", sync)
  }

  return (
    <box class="tray" spacing={2}>
      <For each={items}>
        {(item) => (
          <menubutton
            class="bar-item tray-item"
            $={(self) => setup(self, item)}
            tooltipMarkup={createBinding(item, "tooltipMarkup")}
          >
            <image gicon={createBinding(item, "gicon")} />
          </menubutton>
        )}
      </For>
    </box>
  )
}
