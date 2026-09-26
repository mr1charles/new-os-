/**
 * The shell's client for newos-spacesd (org.newos.Spaces1). Installed, it is on the system
 * bus; `NEWOS_SPACES_BUS=session` points at a development instance (`newos-spacesd --session`).
 */
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import { parseSpaces, parseSpacesError, type Outcome, type Space } from "./login-flow"

const NAME = "org.newos.Spaces1"
const PATH = "/org/newos/Spaces1"

function bus(): Gio.DBusConnection {
  return GLib.getenv("NEWOS_SPACES_BUS") === "session"
    ? Gio.bus_get_sync(Gio.BusType.SESSION, null)
    : Gio.bus_get_sync(Gio.BusType.SYSTEM, null)
}

function call(method: string, args: GLib.Variant | null): Promise<GLib.Variant> {
  return new Promise((resolve, reject) => {
    bus().call(
      NAME,
      PATH,
      NAME,
      method,
      args,
      null,
      Gio.DBusCallFlags.NONE,
      15_000,
      null,
      (conn, res) => {
        try {
          resolve(conn!.call_finish(res))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      },
    )
  })
}

export async function listSpaces(): Promise<Space[]> {
  try {
    const reply = await call("ListSpaces", null)
    return parseSpaces(reply.deep_unpack<[string]>()[0])
  } catch {
    return []
  }
}

/** Which space the password opens. The password is only held for the call. */
export async function resolvePassword(password: string): Promise<Outcome> {
  try {
    const reply = await call("ResolvePassword", new GLib.Variant("(s)", [password]))
    return { kind: "space", account: reply.deep_unpack<[string]>()[0] }
  } catch (error) {
    return parseSpacesError(String(error))
  }
}

/**
 * From the lock screen: bring the space this password opens to the screen (it stays
 * logged in; this one stays locked). "notrunning" when that space is not logged in.
 */
export async function switchTo(password: string): Promise<Outcome> {
  try {
    const reply = await call("SwitchTo", new GLib.Variant("(s)", [password]))
    return { kind: "space", account: reply.deep_unpack<[string]>()[0] }
  } catch (error) {
    return parseSpacesError(String(error))
  }
}
