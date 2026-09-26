import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, For, onCleanup, type Accessor } from "ags"
import type { AstalHyprland } from "../lib/services"
import { hyprland } from "../lib/services"
import { appList, findApplication, toDockApp } from "../lib/apps"
import {
  buildDockItems,
  magnifyLevel,
  normalizeEntry,
  type DockClient,
  type DockItem,
} from "../lib/dock-model"
import { config, updateConfig } from "../lib/config"
import { openLauncher } from "../lib/popups"
import { setImageSource } from "../lib/icons"

function toDockClient(client: AstalHyprland.Client): DockClient {
  return {
    address: client.address,
    class: client.class ?? "",
    initialClass: client.initialClass ?? "",
    title: client.title ?? "",
    focusHistoryId: client.focusHistoryId,
  }
}

interface ShownItem extends DockItem {
  /** First running app after the pinned ones gets a divider, like macOS. */
  divider: boolean
}

const clients: Accessor<AstalHyprland.Client[]> = hyprland
  ? createBinding(hyprland, "clients")
  : createState<AstalHyprland.Client[]>([])[0]

export const dockItems = createComputed<ShownItem[]>(() => {
  const items = buildDockItems(
    config().dock.pinned,
    appList().map(toDockApp),
    clients().map(toDockClient),
  )
  return items.map((item, index) => ({
    ...item,
    divider: !item.pinned && (index === 0 || items[index - 1]!.pinned),
  }))
})

function focusClient(address: string) {
  const client = hyprland?.get_client(address)
  if (!client) return
  if (client.workspace && client.workspace.id !== hyprland?.focusedWorkspace?.id)
    client.workspace.focus()
  client.focus()
}

function activateItem(item: DockItem, launched: () => void) {
  if (item.windows.length > 0) {
    // Clicking the frontmost app cycles its windows; otherwise bring its last window forward.
    const focused = hyprland?.focusedClient?.address
    const index = item.windows.findIndex((w) => w.address === focused)
    const target = index >= 0 ? item.windows[(index + 1) % item.windows.length]! : item.windows[0]!
    focusClient(target.address)
    return
  }
  const application = item.app ? findApplication(item.app.entry) : null
  if (application?.launch()) launched()
}

function togglePinned(item: DockItem) {
  const key = item.key
  updateConfig((c) => {
    const pinned = c.dock.pinned.filter((entry) => normalizeEntry(entry) !== key)
    if (!item.pinned && item.app) pinned.push(item.app.entry.replace(/\.desktop$/, ""))
    c.dock.pinned = pinned
  })
}

function quitItem(item: DockItem) {
  for (const window of item.windows) hyprland?.dispatch("closewindow", `address:${window.address}`)
}

function ContextMenu(props: {
  item: Accessor<ShownItem>
  onLaunch: () => void
  popover: Gtk.Popover
}) {
  const close = () => props.popover.popdown()
  const menuButton = (
    label: Accessor<string> | string,
    action: () => void,
    visible: Accessor<boolean> | boolean = true,
  ) => (
    <button
      class="menu-item"
      visible={visible}
      onClicked={() => {
        close()
        action()
      }}
    >
      <label label={label} xalign={0} />
    </button>
  )
  const running = props.item.as((i) => i.windows.length > 0)
  return (
    <box orientation={Gtk.Orientation.VERTICAL} class="dock-menu">
      <For each={props.item.as((i) => i.windows)} id={(w: DockClient) => w.address}>
        {(window: DockClient) =>
          menuButton(window.title || props.item.peek().name, () => focusClient(window.address))
        }
      </For>
      <Gtk.Separator class="menu-separator" visible={running} />
      {menuButton(
        "Open",
        () => {
          const application = props.item.peek().app
            ? findApplication(props.item.peek().app!.entry)
            : null
          if (application?.launch()) props.onLaunch()
        },
        props.item.as((i) => i.app !== null),
      )}
      {menuButton(
        props.item.as((i) => (i.pinned ? "Remove from Dock" : "Keep in Dock")),
        () => togglePinned(props.item.peek()),
        props.item.as((i) => i.app !== null),
      )}
      {menuButton("Quit", () => quitItem(props.item.peek()), running)}
    </box>
  )
}

const POPOVER_SIDE = {
  bottom: Gtk.PositionType.TOP,
  left: Gtk.PositionType.RIGHT,
  right: Gtk.PositionType.LEFT,
} as const

export function DockIcon(props: {
  item: ShownItem
  index: Accessor<number>
  hovered: Accessor<number | null>
  setHovered: (i: number | null) => void
}) {
  const key = props.item.key
  const item = dockItems.as((items) => items.find((i) => i.key === key) ?? props.item)
  const [launching, setLaunching] = createState(false)
  let bounceSource: number | null = null

  const launched = () => {
    setLaunching(true)
    if (bounceSource !== null) GLib.source_remove(bounceSource)
    bounceSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1600, () => {
      bounceSource = null
      setLaunching(false)
      return GLib.SOURCE_REMOVE
    })
  }
  onCleanup(() => {
    if (bounceSource !== null) GLib.source_remove(bounceSource)
  })

  const cls = createComputed(() => {
    const level = config().dock.magnification ? magnifyLevel(props.index() + 1, props.hovered()) : 0
    const i = item()
    return [
      "dock-item",
      `mag-${level}`,
      i.windows.length > 0 ? "running" : "",
      launching() ? "launching" : "",
      i.divider ? "divider" : "",
    ].join(" ")
  })

  let popover: Gtk.Popover | null = null

  const setup = (button: Gtk.Button) => {
    popover = new Gtk.Popover({
      hasArrow: true,
      position: POPOVER_SIDE[config.peek().dock.position],
      cssClasses: ["dock-popover"],
    })
    onCleanup(
      config.subscribe(() => popover?.set_position(POPOVER_SIDE[config.peek().dock.position])),
    )
    popover.set_parent(button)
    popover.set_child(ContextMenu({ item, onLaunch: launched, popover }) as Gtk.Widget)
    onCleanup(() => popover?.unparent())

    const rightClick = new Gtk.GestureClick({ button: Gdk.BUTTON_SECONDARY })
    rightClick.connect("pressed", () => popover?.popup())
    button.add_controller(rightClick)
  }

  return (
    <button
      class={cls}
      tooltipText={item.as((i) => i.name)}
      onClicked={() => activateItem(item.peek(), launched)}
      $={setup}
    >
      <Gtk.EventControllerMotion onEnter={() => props.setHovered(props.index.peek() + 1)} />
      <box orientation={Gtk.Orientation.VERTICAL} class="dock-item-content">
        <image
          class="dock-icon"
          $={(self) => {
            setImageSource(self, item.peek().iconName, "application-x-executable")
            item.subscribe(() =>
              setImageSource(self, item.peek().iconName, "application-x-executable"),
            )
          }}
        />
        <box class="running-dot" halign={Gtk.Align.CENTER} />
      </box>
    </button>
  )
}

/**
 * The Dock: pinned apps, running apps, and Launchpad. Icons magnify around the pointer and
 * bounce while an app launches. Right-click for windows, Keep in Dock, and Quit.
 */
export default function Dock({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const [hovered, setHovered] = createState<number | null>(null)
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const position = config.as((c) => c.dock.position)
  const vertical = position.as((p) => p !== "bottom")
  const orientation = vertical.as((v) =>
    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
  )
  const launchpadLevel = createComputed(() =>
    config().dock.magnification ? magnifyLevel(0, hovered()) : 0,
  )

  return (
    <window
      name={`dock-${gdkmonitor.connector}`}
      namespace="newos-dock"
      class="dock-window"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.TOP}
      anchor={position.as((p) => (p === "left" ? LEFT : p === "right" ? RIGHT : BOTTOM))}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      keymode={Astal.Keymode.NONE}
      marginBottom={position.as((p) => (p === "bottom" ? 6 : 0))}
      marginStart={position.as((p) => (p === "left" ? 6 : 0))}
      marginEnd={position.as((p) => (p === "right" ? 6 : 0))}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={config.as((c) => c.dock.style === "dock")}
    >
      {/* Fixed-size shelf: magnified icons grow inside it, so the reserved screen area never changes. */}
      <box
        class={createComputed(
          () => `dock-shelf dock-${position()} icons-${config().dock.iconSize}`,
        )}
        orientation={orientation}
      >
        <box
          class="dock"
          orientation={orientation}
          valign={position.as((p) => (p === "bottom" ? Gtk.Align.END : Gtk.Align.CENTER))}
          halign={position.as((p) =>
            p === "left" ? Gtk.Align.START : p === "right" ? Gtk.Align.END : Gtk.Align.CENTER,
          )}
        >
          <Gtk.EventControllerMotion onLeave={() => setHovered(null)} />
          <button
            class={launchpadLevel.as((l) => `dock-item launchpad mag-${l}`)}
            tooltipText="Launchpad"
            onClicked={() => openLauncher("grid")}
          >
            <Gtk.EventControllerMotion onEnter={() => setHovered(0)} />
            <box orientation={Gtk.Orientation.VERTICAL} class="dock-item-content">
              <image class="dock-icon" iconName="newos-launchpad" />
              <box class="running-dot" halign={Gtk.Align.CENTER} />
            </box>
          </button>
          <For each={dockItems} id={(item) => item.key}>
            {(item, index) => (
              <DockIcon item={item} index={index} hovered={hovered} setHovered={setHovered} />
            )}
          </For>
        </box>
      </box>
    </window>
  )
}
