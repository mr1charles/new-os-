import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState } from "ags"
import { logOut, openApp, openSettings, restart, shutdown, suspend } from "../../lib/system"
import { lockSession } from "../LockScreen"

type PendingAction = "restart" | "shutdown" | "logout" | null

/** The OS logo menu at the far left of the bar (the Apple menu equivalent). */
export default function SystemMenu() {
  let popover: Gtk.Popover | null = null
  const [pending, setPending] = createState<PendingAction>(null)
  const realName = GLib.get_real_name()
  const who = realName && realName !== "Unknown" ? realName : GLib.get_user_name()

  const close = () => {
    setPending(null)
    popover?.popdown()
  }

  const item = (label: string, action: () => unknown, hint = "") => (
    <button
      class="menu-item"
      onClicked={() => {
        close()
        action()
      }}
    >
      <box>
        <label label={label} hexpand xalign={0} />
        <label class="menu-hint" label={hint} />
      </box>
    </button>
  )

  const confirmable = (
    label: string,
    kind: Exclude<PendingAction, null>,
    question: string,
    action: () => unknown,
  ) => (
    <box orientation={Gtk.Orientation.VERTICAL}>
      <button
        class="menu-item"
        visible={pending.as((p) => p !== kind)}
        onClicked={() => setPending(kind)}
      >
        <label label={label} xalign={0} />
      </button>
      <box class="menu-confirm" spacing={6} visible={pending.as((p) => p === kind)}>
        <label label={question} hexpand xalign={0} />
        <button class="pill" onClicked={() => setPending(null)} label="Cancel" />
        <button
          class="pill destructive"
          onClicked={() => {
            close()
            action()
          }}
          label={label.replace("…", "")}
        />
      </box>
    </box>
  )

  const separator = () => <Gtk.Separator class="menu-separator" />

  return (
    <menubutton class="bar-item logo" tooltipText="NewOS">
      <image iconName="newos-logo-symbolic" />
      <popover
        $={(self) => (popover = self)}
        class="system-menu"
        hasArrow={false}
        onClosed={() => setPending(null)}
      >
        <box orientation={Gtk.Orientation.VERTICAL}>
          {item("About This Computer", () => openSettings("about"))}
          {separator()}
          {item("System Settings…", () => openSettings(), "Super ,")}
          {item("App Store…", () => openApp("newos-appstore"))}
          {separator()}
          {item("Sleep", suspend)}
          {confirmable("Restart…", "restart", "Restart now?", restart)}
          {confirmable("Shut Down…", "shutdown", "Shut down now?", shutdown)}
          {separator()}
          {item("Lock Screen", lockSession, "Super L")}
          {confirmable(`Log Out ${who}…`, "logout", "Log out now?", logOut)}
        </box>
      </popover>
    </menubutton>
  )
}
