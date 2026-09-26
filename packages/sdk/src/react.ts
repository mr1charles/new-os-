/** React bindings for the SDK. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { CommandArgs, CommandName, CommandResult } from "./commands"
import { call } from "./ipc"
import { settings as store, type Settings, type SettingsPatch } from "./settings"
import { applyTheme } from "./theme"

/** The live settings and an updater. Re-renders on any change, from anywhere. */
export function useSettings(): [Settings, (patch: SettingsPatch) => Promise<void>] {
  useEffect(() => {
    void store.load()
  }, [])
  const value = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.value,
  )
  const update = useCallback((patch: SettingsPatch) => store.update(patch), [])
  return [value, update]
}

/**
 * Keep the document's theme and accent in sync with the settings. "auto" is re-checked every
 * minute so the switch at 07:00 and 19:00 happens without a restart.
 */
export function useAppTheme() {
  const [value] = useSettings()
  useEffect(() => {
    applyTheme(value)
    if (value.appearance.theme !== "auto") return
    const timer = setInterval(() => applyTheme(value), 60_000)
    return () => clearInterval(timer)
  }, [value])
}

export interface CommandState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  /** Run the command again (e.g. after a change, or on a timer). */
  reload: () => Promise<void>
}

/**
 * Load a backend command's result, with loading and error state. `args` are compared by
 * value, so an inline object does not reload on every render.
 */
export function useCommand<K extends CommandName>(
  command: K,
  args?: CommandArgs<K>,
  options: { refreshMs?: number; enabled?: boolean } = {},
): CommandState<CommandResult<K>> {
  const { refreshMs, enabled = true } = options
  const [data, setData] = useState<CommandResult<K>>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const key = JSON.stringify(args ?? {})
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const id = ++latest.current
    setLoading(true)
    try {
      const run = call as (c: K, a: unknown) => Promise<CommandResult<K>>
      const result = await run(command, JSON.parse(key))
      if (id !== latest.current) return
      setData(result)
      setError(null)
    } catch (e) {
      if (id !== latest.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === latest.current) setLoading(false)
    }
  }, [command, key])

  useEffect(() => {
    if (!enabled) return
    void reload()
    if (!refreshMs) return
    const timer = setInterval(() => void reload(), refreshMs)
    return () => clearInterval(timer)
  }, [reload, enabled, refreshMs])

  return { data, error, loading, reload }
}

/**
 * Run an action (a command that changes something) with pending and error state, for buttons
 * and toggles.
 */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true)
      setError(null)
      try {
        return await action(...args)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [action],
  )
  return { run, pending, error, clearError: () => setError(null) }
}
