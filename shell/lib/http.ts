/**
 * Small HTTP helper for the shell (weather). One long-lived Soup session, the whole reply read
 * at once, and errors people can read. (gnim's fetch drops its session while the body is
 * still being read and never checks the status, so a busy server shows up as a JSON error.)
 */
import GLib from "gi://GLib?version=2.0"
import Soup from "gi://Soup?version=3.0"

const session = new Soup.Session({ timeout: 20, userAgent: "HelixOS/0.1" })

export class HttpError extends Error {}

export function getJson(url: string): Promise<unknown> {
  const message = Soup.Message.new("GET", url)
  if (!message) return Promise.reject(new HttpError("Bad address."))
  message.get_request_headers().append("Accept", "application/json")
  return new Promise((resolve, reject) => {
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_s, result) => {
      let bytes: GLib.Bytes
      try {
        bytes = session.send_and_read_finish(result)
      } catch {
        reject(new HttpError("No internet connection."))
        return
      }
      const status = message.get_status()
      if (status < 200 || status >= 300) {
        reject(
          new HttpError(
            status >= 500
              ? "The service is busy. Trying again soon."
              : `The service answered ${status}.`,
          ),
        )
        return
      }
      try {
        const data = bytes.get_data()
        resolve(JSON.parse(new TextDecoder().decode(data ?? new Uint8Array())))
      } catch {
        reject(new HttpError("The service sent something unexpected. Trying again soon."))
      }
    })
  })
}
