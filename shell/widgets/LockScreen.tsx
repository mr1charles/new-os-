/**
 * The lock screen, on ext-session-lock: until the shell unlocks, the compositor shows nothing
 * else and sends input nowhere else, and if the shell dies while locked the screen stays
 * locked (Hyprland: misc:allow_session_lock_restore lets a restarted shell take over).
 *
 * Your own password unlocks. A password for another space is recognized (spacesd), and
 * switching to it comes with fast user switching.
 */
import app from "ags/gtk4/app"
import Gtk from "gi://Gtk?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import AstalAuth from "gi://AstalAuth"
import Gtk4SessionLock from "gi://Gtk4SessionLock?version=1.0"
import { createState } from "ags"
import { listSpaces, resolvePassword } from "../lib/spaces"
import { notify } from "../lib/system"
import { waitMessage } from "../lib/login-flow"
import { wallpaperPath } from "./Wallpaper"
import LoginView, { type Attempt } from "./login/LoginView"

let instance: Gtk4SessionLock.Instance | null = null
const windows: Gtk.Window[] = []
const [spaceName, setSpaceName] = createState(GLib.get_real_name() || GLib.get_user_name())

function checkOwnPassword(password: string): Promise<boolean> {
  return new Promise((resolve) => {
    const started = AstalAuth.Pam.authenticate(password, (_, result) => {
      try {
        resolve(AstalAuth.Pam.authenticate_finish(result) === 0)
      } catch {
        resolve(false)
      }
    })
    if (!started) resolve(false)
  })
}

async function attempt(password: string): Promise<Attempt> {
  if (await checkOwnPassword(password)) {
    unlock()
    return { ok: true }
  }
  // Maybe it is another space's password.
  const outcome = await resolvePassword(password)
  if (outcome.kind === "space" && outcome.account !== GLib.get_user_name()) {
    const other =
      (await listSpaces()).find((s) => s.account === outcome.account)?.name ?? outcome.account
    return {
      ok: false,
      info: true,
      message: `That’s the password for “${other}”. Switching spaces from the lock screen comes in the next update: unlock this space first.`,
    }
  }
  if (outcome.kind === "ratelimited")
    return { ok: false, message: waitMessage(outcome.seconds), wait: outcome.seconds }
  return { ok: false, message: "Wrong password." }
}

function lockWindow(monitor: Gdk.Monitor, primary: boolean): Gtk.Window {
  const overlay = new Gtk.Overlay()
  const picture = new Gtk.Picture({
    file: Gio.File.new_for_path(wallpaperPath.peek()),
    contentFit: Gtk.ContentFit.COVER,
    canShrink: true,
    hexpand: true,
    vexpand: true,
  })
  picture.add_css_class("login-wallpaper")
  overlay.set_child(picture)
  if (primary) {
    overlay.add_overlay(
      LoginView({ title: spaceName, subtitle: "Locked", onSubmit: attempt }) as Gtk.Widget,
    )
  }
  const window = new Gtk.Window({ application: app, child: overlay })
  window.add_css_class("lock-window")
  windows.push(window)
  return window
}

export function lockSession() {
  if (instance?.is_locked()) return
  if (!Gtk4SessionLock.is_supported()) {
    void notify("Can’t lock the screen", "The compositor doesn’t support ext-session-lock.")
    return
  }
  void listSpaces().then((spaces) => {
    const own = spaces.find((s) => s.account === GLib.get_user_name())
    if (own) setSpaceName(own.name)
  })
  instance = Gtk4SessionLock.Instance.new()
  let first = true
  instance.connect("monitor", (_self, monitor) => {
    const window = lockWindow(monitor, first)
    first = false
    instance!.assign_window_to_monitor(window, monitor)
    window.present()
  })
  instance.connect("failed", () => {
    void notify("Couldn’t lock the screen", "Another program may be locking it already.")
    cleanup()
  })
  instance.connect("unlocked", cleanup)
  instance.lock()
}

function unlock() {
  instance?.unlock()
}

function cleanup() {
  for (const w of windows.splice(0)) w.destroy()
  instance = null
}

/**
 * Lock when logind asks (idle timeout, `loginctl lock-session`, lid close with hypridle).
 * Skipped in testing mode, where the logind session belongs to the host desktop.
 */
export function followLogind() {
  const session = GLib.getenv("XDG_SESSION_ID")
  if (!session || GLib.getenv("NEWOS_LIVE") === "1") return
  const system = Gio.bus_get_sync(Gio.BusType.SYSTEM, null)
  system.call(
    "org.freedesktop.login1",
    "/org/freedesktop/login1",
    "org.freedesktop.login1.Manager",
    "GetSession",
    new GLib.Variant("(s)", [session]),
    new GLib.VariantType("(o)"),
    Gio.DBusCallFlags.NONE,
    -1,
    null,
    (conn, res) => {
      try {
        const [path] = conn!.call_finish(res).deep_unpack<[string]>()
        system.signal_subscribe(
          "org.freedesktop.login1",
          "org.freedesktop.login1.Session",
          "Lock",
          path,
          null,
          Gio.DBusSignalFlags.NONE,
          () => lockSession(),
        )
      } catch (error) {
        console.warn(`newos: cannot follow logind locks: ${String(error)}`)
      }
    },
  )
}
