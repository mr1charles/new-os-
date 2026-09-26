/**
 * Live activities from apps: the shell owns `org.newos.Shell1` on the session bus and serves
 * `org.newos.Island1` at /org/newos/Island1.
 *
 *   Show(s id, s activity)   activity: JSON {app, icon, title, subtitle, progress: 0..1 | null}
 *   End(s id)
 *
 * Apps call it through `island` in @newos/sdk (appkit::island). Ids are scoped to the caller's
 * bus name, so apps cannot replace or end each other's activities, and an app's activities
 * end when it disconnects.
 */
import Gio from "gi://Gio?version=2.0"
import { island } from "./island"
import { parseActivity, scopedId } from "./island-activity"

const XML = `<node>
  <interface name="org.newos.Island1">
    <method name="Show">
      <arg type="s" name="id" direction="in"/>
      <arg type="s" name="activity" direction="in"/>
    </method>
    <method name="End">
      <arg type="s" name="id" direction="in"/>
    </method>
  </interface>
</node>`

/** Sender -> ids it shows, to clean up when the app goes away. */
const owned = new Map<string, Set<string>>()
let exported: Gio.DBusExportedObject | null = null

function forgetSender(sender: string) {
  for (const id of owned.get(sender) ?? []) island.dismiss(id)
  owned.delete(sender)
}

export function serveIsland() {
  const bus = Gio.DBus.session
  // GJS passes (parameters, invocation) to methods named <Method>Async, which gives us the
  // caller's unique name.
  exported = Gio.DBusExportedObject.wrapJSObject(XML, {
    ShowAsync([id, json]: [string, string], invocation: Gio.DBusMethodInvocation) {
      const sender = invocation.get_sender() ?? "unknown"
      const payload = parseActivity(json)
      if (!payload) {
        invocation.return_dbus_error(
          "org.newos.Island1.Error.Invalid",
          "An activity needs at least a title.",
        )
        return
      }
      const scoped = scopedId(sender, id)
      island.upsert("activity", payload, { id: scoped })
      if (!owned.has(sender)) {
        owned.set(sender, new Set())
        // End the app's activities if it quits or crashes without ending them.
        bus.signal_subscribe(
          "org.freedesktop.DBus",
          "org.freedesktop.DBus",
          "NameOwnerChanged",
          "/org/freedesktop/DBus",
          sender,
          Gio.DBusSignalFlags.NONE,
          (_c, _s, _p, _i, _n, params) => {
            const [, , newOwner] = params.deep_unpack<[string, string, string]>()
            if (newOwner === "") forgetSender(sender)
          },
        )
      }
      owned.get(sender)!.add(scoped)
      invocation.return_value(null)
    },
    EndAsync([id]: [string], invocation: Gio.DBusMethodInvocation) {
      const sender = invocation.get_sender() ?? "unknown"
      const scoped = scopedId(sender, id)
      island.dismiss(scoped)
      owned.get(sender)?.delete(scoped)
      invocation.return_value(null)
    },
  })
  exported.export(bus, "/org/newos/Island1")
  Gio.bus_own_name_on_connection(bus, "org.newos.Shell1", Gio.BusNameOwnerFlags.NONE, null, () =>
    console.warn("newos: another shell owns org.newos.Shell1"),
  )
}
