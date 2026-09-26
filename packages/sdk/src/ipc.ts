/**
 * Calls into the app's Rust backend. Inside Tauri this is `invoke`; in a plain browser (the UI
 * playground, `vite dev` without Tauri, tests) it goes to a mock backend so the whole UI can
 * be developed and tested without a Linux desktop.
 */
import type { CommandArgs, CommandName, CommandResult } from "./commands"

export type MockHandler = (args: Record<string, unknown>) => unknown
export type MockBackend = Partial<Record<CommandName, MockHandler>>

export type Listener<T> = (payload: T) => void

let mockBackend: MockBackend | null = null
const mockListeners = new Map<string, Set<Listener<unknown>>>()

/** True inside a Tauri webview. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Route calls to `backend` instead of Tauri. Used by the browser playground and tests. */
export function setMockBackend(backend: MockBackend | null) {
  mockBackend = backend
}

/** The mock's handler for a command, when the mock backend is active. */
export function getMockHandler(command: string): MockHandler | undefined {
  return (mockBackend as Record<string, MockHandler> | null)?.[command]
}

/** Deliver an event to `listen()` subscribers when running on the mock backend. */
export function emitMockEvent<T>(event: string, payload: T) {
  for (const listener of mockListeners.get(event) ?? []) listener(payload)
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    message: string,
  ) {
    super(message)
    this.name = "CommandError"
  }
}

/** Call a backend command. Rejects with a {@link CommandError} carrying a readable message. */
export async function call<K extends CommandName>(
  command: K,
  ...args: CommandArgs<K> extends Record<string, never> ? [] : [CommandArgs<K>]
): Promise<CommandResult<K>> {
  const payload = (args[0] ?? {}) as Record<string, unknown>
  if (mockBackend || !inTauri()) {
    const handler = mockBackend?.[command]
    if (!handler) throw new CommandError(command, `${command} is not available here`)
    try {
      return (await handler(payload)) as CommandResult<K>
    } catch (error) {
      throw new CommandError(command, error instanceof Error ? error.message : String(error))
    }
  }
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<CommandResult<K>>(command, payload)
  } catch (error) {
    throw new CommandError(command, typeof error === "string" ? error : String(error))
  }
}

/** Subscribe to a backend event. Returns an unsubscribe function. */
export async function listen<T>(event: string, listener: Listener<T>): Promise<() => void> {
  if (mockBackend || !inTauri()) {
    let set = mockListeners.get(event)
    if (!set) mockListeners.set(event, (set = new Set()))
    set.add(listener as Listener<unknown>)
    return () => set.delete(listener as Listener<unknown>)
  }
  const { listen: tauriListen } = await import("@tauri-apps/api/event")
  return tauriListen<T>(event, (e) => listener(e.payload))
}

/**
 * A streaming call: the backend pushes text chunks through a Tauri channel until it resolves.
 * On the mock backend the handler receives `onChunk` in its arguments.
 */
export async function callStreaming(
  command: string,
  args: Record<string, unknown>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  if (mockBackend || !inTauri()) {
    const handler = (mockBackend as Record<string, MockHandler> | null)?.[command]
    if (!handler) throw new CommandError(command, `${command} is not available here`)
    await handler({ ...args, onChunk })
    return
  }
  const { Channel, invoke } = await import("@tauri-apps/api/core")
  const channel = new Channel<string>()
  channel.onmessage = onChunk
  try {
    await invoke(command, { ...args, onChunk: channel })
  } catch (error) {
    throw new CommandError(command, typeof error === "string" ? error : String(error))
  }
}
