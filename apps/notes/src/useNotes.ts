/**
 * Notes state: the list, folders, the open note, and saving. Edits save 600 ms after typing
 * stops (and immediately when you switch notes). A save can rename the file when the title
 * changes; the open note follows it without reloading the editor.
 */
import { call, CommandError, listen, NOTES_CHANGED_EVENT, type NoteMeta } from "@newos/sdk"
import { useCallback, useEffect, useRef, useState } from "react"

const SAVE_DELAY_MS = 600

/** "all" shows every note; "" is the top level; any other string is a folder. */
export type FolderFilter = "all" | string

export interface OpenNote {
  path: string
  text: string
  /** Changes only when a different note (or a newer version from disk) is loaded. */
  docKey: number
}

export function useNotes() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState<FolderFilter>("all")
  const [open, setOpen] = useState<OpenNote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // The latest text typed into the open note, not yet saved.
  const pending = useRef<{ path: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const openRef = useRef(open)
  openRef.current = open
  const docKeys = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [list, dirs] = await Promise.all([call("notes_list"), call("notes_folders")])
      setNotes(list)
      setFolders(dirs)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [])

  /** Write pending edits now. Returns the saved note (its path may have changed). */
  const flush = useCallback(async (): Promise<NoteMeta | null> => {
    clearTimeout(timer.current)
    const edit = pending.current
    if (!edit) return null
    pending.current = null
    try {
      const saved = await call("note_write", { path: edit.path, text: edit.text })
      if (saved.path !== edit.path) {
        setOpen((o) => (o && o.path === edit.path ? { ...o, path: saved.path } : o))
        // Edits typed during the save still point at the old name.
        const typedSince = pending.current as { path: string; text: string } | null
        if (typedSince && typedSince.path === edit.path) typedSince.path = saved.path
      }
      setNotes((list) => [
        saved,
        ...list.filter((n) => n.path !== edit.path && n.path !== saved.path),
      ])
      return saved
    } catch (e) {
      pending.current ??= edit
      setError(e instanceof CommandError ? e.message : String(e))
      return null
    }
  }, [])

  const edit = useCallback(
    (text: string) => {
      const current = openRef.current
      if (!current) return
      pending.current = { path: pending.current?.path ?? current.path, text }
      setOpen({ ...current, text })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  const select = useCallback(
    async (path: string) => {
      await flush()
      try {
        const text = await call("note_read", { path })
        setOpen({ path, text, docKey: ++docKeys.current })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [flush],
  )

  const create = useCallback(async () => {
    await flush()
    const target = folder === "all" ? "" : folder
    const note = await call("note_create", { folder: target, text: "" })
    await refresh()
    setOpen({
      path: note.path,
      text: await call("note_read", { path: note.path }),
      docKey: ++docKeys.current,
    })
  }, [flush, folder, refresh])

  const remove = useCallback(
    async (path: string) => {
      if (pending.current?.path === path) pending.current = null
      clearTimeout(timer.current)
      await call("note_delete", { path })
      if (openRef.current?.path === path) setOpen(null)
      await refresh()
    },
    [refresh],
  )

  const setPinned = useCallback(
    async (path: string, pinned: boolean) => {
      await call("note_set_pinned", { path, pinned })
      await refresh()
    },
    [refresh],
  )

  const move = useCallback(
    async (path: string, target: string) => {
      await flush()
      const moved = await call("note_move", { path: openRef.current?.path ?? path, folder: target })
      setOpen((o) => (o ? { ...o, path: moved.path } : o))
      await refresh()
    },
    [flush, refresh],
  )

  // Initial load, and follow changes from the assistant or other programs. When the open note
  // changed on disk and has no unsaved edits here, load the new version.
  useEffect(() => {
    void refresh()
    let unlisten: (() => void) | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    void listen(NOTES_CHANGED_EVENT, () => {
      clearTimeout(debounce)
      debounce = setTimeout(async () => {
        await refresh()
        const current = openRef.current
        if (!current || pending.current) return
        try {
          const text = await call("note_read", { path: current.path })
          if (text !== current.text && !pending.current) {
            setOpen({ path: current.path, text, docKey: ++docKeys.current })
          }
        } catch {
          // Renamed or deleted elsewhere: keep what is on screen.
        }
      }, 300)
    }).then((u) => (unlisten = u))
    const save = () => void flush()
    window.addEventListener("beforeunload", save)
    return () => {
      unlisten?.()
      clearTimeout(debounce)
      window.removeEventListener("beforeunload", save)
      void flush()
    }
  }, [refresh, flush])

  const visible = folder === "all" ? notes : notes.filter((n) => n.folder === folder)

  return {
    notes,
    visible,
    folders,
    folder,
    setFolder,
    open,
    loaded,
    error,
    clearError: () => setError(null),
    refresh,
    select,
    edit,
    create,
    remove,
    setPinned,
    move,
    flush,
  }
}
