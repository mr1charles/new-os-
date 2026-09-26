/**
 * The live settings store: `~/.config/helixos/shell.json`, shared with the shell. Reads go
 * through the schema's defaults, writes send only the changed part, and edits made elsewhere
 * (the shell, another app, a text editor) arrive through the backend's file watcher.
 */
import { call, listen } from "./ipc"
import { cloneJson, parseConfig, type ShellConfig } from "./settings-schema"

export type Settings = ShellConfig

/** Recursively optional, for partial updates. Arrays are replaced whole. */
export type SettingsPatch<T = Settings> = {
  [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? SettingsPatch<T[K]> : T[K]
}

export const SETTINGS_CHANGED_EVENT = "helixos://settings-changed"

type Subscriber = (settings: Settings) => void

function parse(value: unknown): Settings {
  return parseConfig(JSON.stringify(value ?? {}))
}

export class SettingsStore {
  #value: Settings = parseConfig(null)
  #subscribers = new Set<Subscriber>()
  #ready: Promise<void> | null = null

  /** Current settings (defaults until {@link load} finishes). */
  get value(): Settings {
    return this.#value
  }

  /** Read the file once and start following changes. Safe to call repeatedly. */
  load(): Promise<void> {
    this.#ready ??= (async () => {
      this.#set(parse(await call("settings_read")))
      await listen<unknown>(SETTINGS_CHANGED_EVENT, (value) => this.#set(parse(value)))
    })()
    return this.#ready
  }

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }

  /**
   * Apply a change now (optimistically) and persist it. If the write fails the previous
   * value comes back and the error is rethrown.
   */
  async update(patch: SettingsPatch): Promise<void> {
    const previous = this.#value
    this.#set(applyPatch(previous, patch))
    try {
      this.#set(parse(await call("settings_update", { patch })))
    } catch (error) {
      this.#set(previous)
      throw error
    }
  }

  #set(next: Settings) {
    if (JSON.stringify(next) === JSON.stringify(this.#value)) return
    this.#value = next
    for (const subscriber of this.#subscribers) subscriber(next)
  }
}

/** Merge a patch the way the backend does: objects merge, everything else replaces. */
export function applyPatch<T>(base: T, patch: unknown): T {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof patch !== "object" ||
    patch === null ||
    Array.isArray(patch)
  ) {
    return (patch === undefined ? base : cloneJson(patch)) as T
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = applyPatch(result[key], value)
  }
  return result as T
}

/** The app-wide store. */
export const settings = new SettingsStore()
