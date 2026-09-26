/**
 * The browser's state: where you are (with back and forward), what is there, the selection,
 * and the clipboard for Copy / Cut / Paste.
 */
import { call, type FileEntry } from "@newos/sdk"
import { useCallback, useEffect, useRef, useState } from "react"

/** A folder path, or the Trash, or search results. */
export type Location =
  | { kind: "folder"; path: string }
  | { kind: "trash" }
  | { kind: "search"; label: string; root: string }

export interface Clipboard {
  paths: string[]
  cut: boolean
}

export function useBrowser(start: string) {
  const [history, setHistory] = useState<{ stack: Location[]; index: number }>({
    stack: [{ kind: "folder", path: start }],
    index: 0,
  })
  const location = history.stack[history.index]!
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const loadId = useRef(0)

  const go = useCallback((next: Location) => {
    setHistory((h) => {
      const current = h.stack[h.index]!
      if (JSON.stringify(current) === JSON.stringify(next)) return h
      const stack = [...h.stack.slice(0, h.index + 1), next]
      return { stack, index: stack.length - 1 }
    })
    setSelected([])
    setAnchor(null)
  }, [])

  const reload = useCallback(async () => {
    if (location.kind !== "folder") return
    const id = ++loadId.current
    setLoading(true)
    try {
      const list = await call("files_list", { path: location.path, showHidden })
      if (id !== loadId.current) return
      setEntries(list)
      setError(null)
      // Keep the selection for items that still exist.
      setSelected((s) => s.filter((p) => list.some((e) => e.path === p)))
    } catch (e) {
      if (id !== loadId.current) return
      setEntries([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === loadId.current) setLoading(false)
    }
  }, [location, showHidden])

  useEffect(() => {
    void reload()
  }, [reload])

  // Folders change behind our back (downloads finishing, other apps): refresh every few
  // seconds while the window is visible.
  useEffect(() => {
    if (location.kind !== "folder") return
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload()
    }, 4000)
    return () => clearInterval(timer)
  }, [location, reload])

  return {
    location,
    entries,
    setEntries,
    loading,
    error,
    setError,
    selected,
    setSelected,
    anchor,
    setAnchor,
    showHidden,
    setShowHidden,
    clipboard,
    setClipboard,
    go,
    reload,
    back: history.index > 0 ? () => setHistory((h) => ({ ...h, index: h.index - 1 })) : undefined,
    forward:
      history.index < history.stack.length - 1
        ? () => setHistory((h) => ({ ...h, index: h.index + 1 }))
        : undefined,
  }
}
