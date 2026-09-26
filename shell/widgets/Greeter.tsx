/**
 * The login screen, run by greetd as the `greeter` user (shell/greeter.ts). One password
 * field: spacesd says which space the password opens, then greetd logs that account in and
 * starts its NewOS session.
 */
import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import AstalGreet from "gi://AstalGreet"
import { createState } from "ags"
import { assetPath } from "../lib/icons"
import { SESSION_COMMAND, waitMessage, type Space } from "../lib/login-flow"
import { listSpaces, resolvePassword } from "../lib/spaces"
import { restart, shutdown } from "../lib/system"
import LoginView, { type Attempt } from "./login/LoginView"

/** NEWOS_GREETER_PREVIEW=1: say which space would open instead of logging in (development). */
const PREVIEW = GLib.getenv("NEWOS_GREETER_PREVIEW") === "1"

function greetdLogin(account: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    AstalGreet.login(account, password, SESSION_COMMAND, (_, result) => {
      try {
        AstalGreet.login_finish(result)
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

const [spaces, setSpaces] = createState<Space[]>([])
void listSpaces().then(setSpaces)

async function attempt(password: string): Promise<Attempt> {
  const outcome = await resolvePassword(password)
  switch (outcome.kind) {
    case "nomatch":
      return { ok: false, message: "That password doesn’t open a space." }
    case "ratelimited":
      return { ok: false, message: waitMessage(outcome.seconds), wait: outcome.seconds }
    case "unavailable":
      return { ok: false, message: outcome.message }
    case "space": {
      const name = spaces.peek().find((s) => s.account === outcome.account)?.name ?? outcome.account
      if (PREVIEW)
        return {
          ok: false,
          info: true,
          message: `This password opens “${name}”. (Preview: not logging in.)`,
        }
      try {
        await greetdLogin(outcome.account, password)
        // greetd starts the session once the greeter exits.
        app.quit()
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          message: `Couldn’t open “${name}”: ${String(error).replace(/^.*?:\s*/, "")}`,
        }
      }
    }
  }
}

function PowerButton({
  icon,
  label,
  onClicked,
}: {
  icon: string
  label: string
  onClicked: () => void
}) {
  return (
    <button class="login-power" onClicked={onClicked}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <image iconName={icon} pixelSize={18} />
        <label label={label} />
      </box>
    </button>
  )
}

export default function Greeter({
  gdkmonitor,
  primary,
}: {
  gdkmonitor: Gdk.Monitor
  primary: boolean
}) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      visible
      name={`greeter-${gdkmonitor.connector}`}
      namespace="newos-greeter"
      class="greeter-window"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.TOP}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={primary ? Astal.Keymode.EXCLUSIVE : Astal.Keymode.NONE}
    >
      <overlay>
        <Gtk.Picture
          class="login-wallpaper"
          hexpand
          vexpand
          canShrink
          contentFit={Gtk.ContentFit.COVER}
          file={Gio.File.new_for_path(assetPath("wallpapers", "newos-dark.svg"))}
        />
        {primary && (
          <LoginView
            $type="overlay"
            title="Welcome"
            onSubmit={attempt}
            footer={
              <box class="login-footer" halign={Gtk.Align.CENTER} spacing={28}>
                <PowerButton
                  icon="system-reboot-symbolic"
                  label="Restart"
                  onClicked={() => void restart()}
                />
                <PowerButton
                  icon="system-shutdown-symbolic"
                  label="Shut Down"
                  onClicked={() => void shutdown()}
                />
              </box>
            }
          />
        )}
      </overlay>
    </window>
  )
}
