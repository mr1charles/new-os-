/**
 * Client for assistantd's HTTP API over its unix socket
 * ($XDG_RUNTIME_DIR/newos/assistant.sock). Uses libsoup with a unix socket connectable, and
 * parses the Server-Sent Events stream line by line.
 */
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import Soup from "gi://Soup?version=3.0"
import { SseParser } from "./sse"
import {
  parseChatEvent,
  parseSystemEvent,
  type ChatEvent,
  type ChatRequest,
  type CompleteRequest,
  type StatusResponse,
  type SystemEvent,
} from "./assistant-protocol"
import { config } from "./config"

Gio._promisify(Soup.Session.prototype, "send_async", "send_finish")
Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish")
Gio._promisify(Gio.DataInputStream.prototype, "read_line_async", "read_line_finish_utf8")

export function socketPath(): string {
  const configured = config.peek().assistant.socketPath
  return (
    configured || GLib.build_filenamev([GLib.get_user_runtime_dir(), "newos", "assistant.sock"])
  )
}

let cachedSession: { path: string; session: Soup.Session } | null = null

function session(): Soup.Session {
  const path = socketPath()
  if (!cachedSession || cachedSession.path !== path) {
    cachedSession = {
      path,
      session: new Soup.Session({
        remoteConnectable: Gio.UnixSocketAddress.new(path),
        timeout: 0,
        idleTimeout: 30,
      }),
    }
  }
  return cachedSession.session
}

function message(method: string, path: string, body?: unknown): Soup.Message {
  const msg = Soup.Message.new(method, `http://localhost${path}`)!
  if (body !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(body))
    msg.set_request_body_from_bytes("application/json", new GLib.Bytes(bytes))
  }
  return msg
}

async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const msg = message(method, path, body)
  const bytes = (await session().send_and_read_async(
    msg,
    GLib.PRIORITY_DEFAULT,
    null,
  )) as GLib.Bytes
  const text = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array())
  if (msg.statusCode < 200 || msg.statusCode >= 300) {
    let detail = text
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      // not JSON
    }
    throw new Error(`assistantd ${msg.statusCode}: ${detail}`)
  }
  return JSON.parse(text) as T
}

/** Stream an SSE response, calling `onEvent` for each event until the stream ends. */
async function stream(
  msg: Soup.Message,
  cancellable: Gio.Cancellable,
  onEvent: (name: string, data: string) => void,
) {
  const input = (await session().send_async(
    msg,
    GLib.PRIORITY_DEFAULT,
    cancellable,
  )) as Gio.InputStream
  if (msg.statusCode < 200 || msg.statusCode >= 300) {
    throw new Error(`assistantd ${msg.statusCode}: ${msg.reasonPhrase}`)
  }
  const data = new Gio.DataInputStream({ baseStream: input, closeBaseStream: true })
  const parser = new SseParser()
  try {
    for (;;) {
      const [line] = (await data.read_line_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
      )) as unknown as [string | null, number]
      if (line === null) break
      const event = parser.feedLine(line)
      if (event) onEvent(event.event, event.data)
    }
    const tail = parser.flush()
    if (tail) onEvent(tail.event, tail.data)
  } finally {
    data.close(null)
  }
}

export async function getStatus(): Promise<StatusResponse | null> {
  try {
    return await requestJson<StatusResponse>("GET", "/v1/status")
  } catch {
    return null
  }
}

export interface ChatHandle {
  cancel(): void
  done: Promise<void>
}

export function chat(request: ChatRequest, onEvent: (event: ChatEvent) => void): ChatHandle {
  const cancellable = new Gio.Cancellable()
  const done = stream(message("POST", "/v1/chat", request), cancellable, (event, data) => {
    const parsed = parseChatEvent({ event, data, id: null })
    if (parsed) onEvent(parsed)
  }).catch((error: unknown) => {
    if (cancellable.is_cancelled()) return
    const text = String(error)
    const unreachable = /No such file|Connection refused|Could not connect/i.test(text)
    onEvent({
      type: "error",
      message: unreachable
        ? "The assistant service is not running. Start it with: systemctl --user start newos-assistantd"
        : text,
    })
  })
  return { cancel: () => cancellable.cancel(), done }
}

export function confirmTool(requestId: string, allow: boolean) {
  return requestJson<{ ok: boolean }>("POST", "/v1/confirm", { request_id: requestId, allow })
}

export async function complete(request: CompleteRequest): Promise<string> {
  const response = await requestJson<{ output: string }>("POST", "/v1/complete", request)
  return response.output
}

/**
 * Follow /v1/events for the lifetime of the shell, reconnecting with backoff while
 * assistantd is down or restarting.
 */
export function followSystemEvents(onEvent: (event: SystemEvent) => void) {
  let delay = 1000
  const connect = () => {
    const cancellable = new Gio.Cancellable()
    stream(message("GET", "/v1/events"), cancellable, (event, data) => {
      delay = 1000
      const parsed = parseSystemEvent({ event, data, id: null })
      if (parsed) onEvent(parsed)
    })
      .catch(() => undefined)
      .finally(() => {
        GLib.timeout_add(GLib.PRIORITY_LOW, delay, () => {
          connect()
          return GLib.SOURCE_REMOVE
        })
        delay = Math.min(delay * 2, 30_000)
      })
  }
  connect()
}
