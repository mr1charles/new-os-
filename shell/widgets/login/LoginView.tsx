/**
 * The login screen and lock screen body: the time, one password field, and a status line.
 * There is no user list: the password decides which space opens (docs/DUAL-SPACE.md).
 */
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, type Accessor } from "ags"
import { now } from "../../lib/clock"
import { waitMessage } from "../../lib/login-flow"

export type Attempt =
  | { ok: true }
  /** `info` messages (not errors) do not shake the field. */
  | { ok: false; message: string; wait?: number; info?: boolean }

export interface LoginViewProps {
  /** Above the field: "Welcome" on the login screen, the space's name when locked. */
  title: Accessor<string> | string
  subtitle?: Accessor<string> | string
  /** Check a password. The field is cleared after every attempt. */
  onSubmit: (password: string) => Promise<Attempt>
  /** Between the clock and the password (the lock screen's Now Playing). */
  middle?: JSX.Element
  /** Buttons at the bottom (Restart, Shut Down on the login screen). */
  footer?: JSX.Element
}

const time = now.as((t) =>
  GLib.DateTime.new_from_unix_local(Math.floor(t / 1000)).format("%-I:%M")!,
)
const date = now.as((t) =>
  GLib.DateTime.new_from_unix_local(Math.floor(t / 1000)).format("%A, %B %-d")!,
)

export default function LoginView(props: LoginViewProps) {
  const [status, setStatus] = createState("")
  const [busy, setBusy] = createState(false)
  const [waitUntil, setWaitUntil] = createState(0)
  let field: Gtk.PasswordEntry | null = null
  let card: Gtk.Box | null = null

  const shake = () => {
    if (!card) return
    card.remove_css_class("shake")
    // Re-adding on the next frame restarts the animation.
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      card?.add_css_class("shake")
      return GLib.SOURCE_REMOVE
    })
  }

  const countdown = () => {
    const left = Math.ceil((waitUntil.peek() - Date.now()) / 1000)
    if (left <= 0) {
      setStatus("")
      field?.set_sensitive(true)
      field?.grab_focus()
      return GLib.SOURCE_REMOVE
    }
    setStatus(waitMessage(left))
    return GLib.SOURCE_CONTINUE
  }

  const submit = async () => {
    if (!field || busy.peek()) return
    const password = field.get_text()
    field.set_text("")
    if (!password) return
    setBusy(true)
    setStatus("")
    try {
      const result = await props.onSubmit(password)
      if (!result.ok) {
        if (!result.info) shake()
        if (result.wait) {
          setWaitUntil(Date.now() + result.wait * 1000)
          field.set_sensitive(false)
          countdown()
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, countdown)
        } else {
          setStatus(result.message)
        }
      }
    } finally {
      setBusy(false)
      if (field.get_sensitive()) field.grab_focus()
    }
  }

  return (
    <box
      class="login"
      orientation={Gtk.Orientation.VERTICAL}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      hexpand
      vexpand
    >
      <label class="login-date" label={date} />
      <label class="login-time" label={time} />
      <box vexpand />
      {props.middle ?? <box />}
      <box vexpand />
      <box
        class="login-card"
        orientation={Gtk.Orientation.VERTICAL}
        spacing={10}
        halign={Gtk.Align.CENTER}
        $={(self) => (card = self)}
      >
        <label class="login-title" label={props.title} />
        {props.subtitle !== undefined && <label class="login-subtitle" label={props.subtitle} />}
        <box class="login-field" spacing={6}>
          <Gtk.PasswordEntry
            $={(self) => {
              field = self
              GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                self.grab_focus()
                return GLib.SOURCE_REMOVE
              })
            }}
            hexpand
            showPeekIcon
            placeholderText="Enter your password"
            onActivate={() => void submit()}
          />
          <button
            class="login-go"
            sensitive={busy.as((b) => !b)}
            onClicked={() => void submit()}
            tooltipText="Continue"
          >
            <image
              iconName={busy.as((b) => (b ? "content-loading-symbolic" : "go-next-symbolic"))}
            />
          </button>
        </box>
        <label
          class="login-status"
          label={status}
          wrap
          maxWidthChars={40}
          justify={Gtk.Justification.CENTER}
        />
      </box>
      <box vexpand />
      {props.footer ?? <box />}
    </box>
  )
}
