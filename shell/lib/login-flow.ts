/**
 * The password field shared by the login screen and the lock screen: what a spacesd reply
 * means and what to tell the user. Pure TypeScript, tested in Node.
 */

export type Outcome =
  | { kind: "space"; account: string }
  | { kind: "nomatch" }
  | { kind: "ratelimited"; seconds: number }
  /** SwitchTo: the password's space exists but is not logged in. */
  | { kind: "notrunning"; name: string }
  | { kind: "unavailable"; message: string }

/**
 * Read a spacesd D-Bus error. GLib shows remote errors as
 * "GDBus.Error:org.helixos.Spaces1.Error.RateLimited: 30".
 */
export function parseSpacesError(error: string): Outcome {
  const match = /org\.helixos\.Spaces1\.Error\.(\w+):\s*(.*)$/s.exec(error)
  if (!match) {
    if (
      /ServiceUnknown|NameHasNoOwner|not provided by any \.service|Could not connect/i.test(error)
    ) {
      return { kind: "unavailable", message: "The space service isn’t running." }
    }
    return { kind: "unavailable", message: error.replace(/^GDBus\.Error:[\w.]+:\s*/, "") }
  }
  const [, name, message] = match
  switch (name) {
    case "NoMatch":
      return { kind: "nomatch" }
    case "RateLimited":
      return { kind: "ratelimited", seconds: Math.max(1, Number.parseInt(message!, 10) || 30) }
    case "NotRunning":
      return { kind: "notrunning", name: message!.trim() }
    default:
      return { kind: "unavailable", message: message!.trim() }
  }
}

/** "Try again in 30 seconds", "Try again in 2 minutes". */
export function waitMessage(seconds: number): string {
  if (seconds < 60) return `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`
  const minutes = Math.ceil(seconds / 60)
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
}

export interface Space {
  account: string
  name: string
  accent: string
  default: boolean
  last_used: number
}

/** Parse spacesd's ListSpaces JSON, skipping anything malformed. */
export function parseSpaces(json: string): Space[] {
  try {
    const value = JSON.parse(json) as unknown
    if (!Array.isArray(value)) return []
    return value.filter(
      (s): s is Space =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Space).account === "string" &&
        typeof (s as Space).name === "string",
    )
  } catch {
    return []
  }
}

/** The space whose look the login screen borrows: the default, or the first. */
export function defaultSpace(spaces: Space[]): Space | undefined {
  return spaces.find((s) => s.default) ?? spaces[0]
}

/** The command greetd starts for a space's session. */
/** The login screen already played the startup animation, so the session does not repeat it. */
export const SESSION_COMMAND =
  "env HELIXOS_FROM_GREETER=1 start-hyprland -- --config /usr/share/helixos/hypr/session.conf"
