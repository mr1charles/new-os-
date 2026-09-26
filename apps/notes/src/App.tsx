import { assistant, call, type NoteMeta, type NoteSearchHit } from "@helixos/sdk"
import { useAppTheme } from "@helixos/sdk/react"
import {
  Button,
  Callout,
  cx,
  EmptyState,
  Field,
  Popover,
  SearchField,
  Select,
  Sheet,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Spinner,
  TextField,
  Toolbar,
  Window,
} from "@helixos/ui"
import {
  Folder,
  FolderPlus,
  NotebookText,
  Pin,
  PinOff,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Editor, type EditorHandle } from "./Editor"
import { askPrompt, bodyRange, keywords, rankSources, shortDate, type Source } from "./logic"
import { useNotes } from "./useNotes"

const TONES = [
  { label: "Clearer", tone: "clearer and more concise" },
  { label: "Friendlier", tone: "warmer and friendlier" },
  { label: "More professional", tone: "more professional and polished" },
  { label: "Shorter", tone: "about half as long, keeping the key points" },
]

function NoteRow({
  note,
  selected,
  snippet,
  onSelect,
}: {
  note: NoteMeta
  selected: boolean
  snippet?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={cx("notes-row", selected && "notes-row--selected")}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="notes-row__title">
        {note.pinned && <Pin size={11} className="notes-row__pin" aria-label="Pinned" />}
        {note.title}
      </span>
      <span className="notes-row__meta">
        <span className="notes-row__date">{shortDate(note.modified)}</span>
        <span className="notes-row__preview">
          {snippet ?? (note.preview || "No additional text")}
        </span>
      </span>
    </button>
  )
}

function NewFolderSheet({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    try {
      await onCreate(name.trim())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="New Folder"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void submit()
        }}
      >
        <Field label="Name">
          {(id) => (
            <TextField
              id={id}
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          )}
        </Field>
      </form>
      {error && <Callout tone="danger">{error}</Callout>}
    </Sheet>
  )
}

/** Answers a question from the user's notes: search, then the assistant with those notes. */
function AskSheet({ onClose, onOpen }: { onClose: () => void; onOpen: (path: string) => void }) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [sources, setSources] = useState<Source[]>([])
  const [provider, setProvider] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "searching" | "answering" | "done">("idle")
  const [error, setError] = useState<string | null>(null)

  const ask = async () => {
    setAnswer("")
    setError(null)
    setProvider(null)
    setState("searching")
    try {
      const words = keywords(question)
      const results = await Promise.all(words.map((w) => call("notes_search", { query: w })))
      const paths = rankSources(
        results.map((hits: NoteSearchHit[]) => hits.map((h) => h.note.path)),
      )
      const titles = new Map(results.flat().map((h) => [h.note.path, h.note.title]))
      const found = await Promise.all(
        paths.map(async (path) => ({
          path,
          title: titles.get(path) ?? path,
          text: await call("note_read", { path }),
        })),
      )
      setSources(found)
      if (found.length === 0) {
        setAnswer("None of your notes mention that.")
        setState("done")
        return
      }
      setState("answering")
      await assistant.chat({ message: askPrompt(question, found) }, (event) => {
        if (event.type === "start") setProvider(event.provider === "cloud" ? "Cloud" : "On-device")
        else if (event.type === "text") setAnswer((a) => a + event.delta)
        else if (event.type === "error") setError(event.message)
      })
      setState("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState("done")
    }
  }

  const busy = state === "searching" || state === "answering"
  return (
    <Sheet
      open
      onClose={onClose}
      title="Ask My Notes"
      width={560}
      actions={<Button onClick={onClose}>Done</Button>}
    >
      <form
        className="notes-ask"
        onSubmit={(e) => {
          e.preventDefault()
          if (question.trim() && !busy) void ask()
        }}
      >
        <TextField
          autoFocus
          aria-label="Question"
          placeholder="What did I decide about the Q4 plan?"
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
        />
        <Button type="submit" variant="primary" disabled={!question.trim() || busy}>
          Ask
        </Button>
      </form>
      {busy && (
        <div className="notes-ask__status">
          <Spinner size={14} />{" "}
          {state === "searching" ? "Looking through your notes…" : "Thinking…"}
        </div>
      )}
      {answer && (
        <div className="notes-ask__answer" aria-live="polite">
          {provider && <span className="notes-ask__provider">{provider}</span>}
          {answer}
        </div>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      {sources.length > 0 && (
        <div className="notes-ask__sources">
          <span>From</span>
          {sources.map((s) => (
            <button
              key={s.path}
              type="button"
              className="notes-chip"
              onClick={() => (onOpen(s.path), onClose())}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

export function App() {
  useAppTheme()
  const n = useNotes()
  const editor = useRef<EditorHandle | null>(null)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [newFolder, setNewFolder] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (!query.trim()) return setHits(null)
    const t = setTimeout(() => {
      call("notes_search", { query })
        .then((h) => setHits(n.folder === "all" ? h : h.filter((x) => x.note.folder === n.folder)))
        .catch(() => setHits([]))
    }, 150)
    return () => clearTimeout(t)
  }, [query, n.folder, n.notes])

  // Open the most recent note on start.
  const first = n.visible[0]?.path
  useEffect(() => {
    if (!n.open && first) void n.select(first)
    // Only when nothing is open yet.
  }, [first])

  const openMeta = useMemo(
    () => n.notes.find((x) => x.path === n.open?.path),
    [n.notes, n.open?.path],
  )

  /** Run an assistant task on the selection, or on the note body when nothing is selected. */
  const runAi = async (label: string, work: (text: string) => Promise<void>) => {
    setAiOpen(false)
    setAiNotice(null)
    setAiBusy(label)
    try {
      await work(editor.current?.text() ?? "")
    } catch (e) {
      setAiNotice(
        e instanceof Error && /not running|unavailable/i.test(e.message)
          ? "The assistant isn’t running. Start it, or check Settings → Assistant."
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setAiBusy(null)
    }
  }

  const target = (text: string) =>
    editor.current?.selection() ?? { ...bodyRange(text), text: text.slice(bodyRange(text).from) }

  const summarize = () =>
    runAi("Summarizing", async (text) => {
      const { text: input } = target(text)
      if (!input.trim()) throw new Error("There’s nothing to summarize yet.")
      setSummary(await assistant.complete("summarize", input))
    })

  const rewrite = (tone: string) =>
    runAi("Rewriting", async (text) => {
      const range = target(text)
      if (!range.text.trim()) throw new Error("Select some text, or write something first.")
      const result = await assistant.complete("rewrite", range.text, { tone })
      editor.current?.replace(range.from, range.to, result.trim())
      setAiNotice("Rewritten. Press Ctrl+Z to undo.")
    })

  const continueWriting = () =>
    runAi("Writing", async (text) => {
      if (!text.trim()) throw new Error("Write a few words first.")
      const more = await assistant.complete("continue", text.slice(-6000))
      const sep = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n"
      editor.current?.replace(text.length, text.length, sep + more.trim() + "\n")
      setAiNotice("Added. Press Ctrl+Z to undo.")
    })

  const insertSummary = () => {
    if (!summary || !editor.current) return
    const text = editor.current.text()
    const { from } = bodyRange(text)
    const at = from === text.length && !text.endsWith("\n") ? text.length : from
    editor.current.replace(
      at,
      at,
      `${at === text.length ? "\n\n" : ""}**Summary**\n${summary.trim()}\n\n`,
    )
    setSummary(null)
  }

  const folderOptions = [
    { value: "", label: "Notes" },
    ...n.folders.map((f) => ({ value: f, label: f })),
  ]
  const count = (f: string) => n.notes.filter((x) => x.folder === f).length

  const sidebar = (
    <Sidebar>
      <SidebarSection>
        <SidebarItem
          label="All Notes"
          icon={<NotebookText size={16} />}
          detail={String(n.notes.length)}
          selected={n.folder === "all"}
          onSelect={() => n.setFolder("all")}
        />
        <SidebarItem
          label="Notes"
          icon={<Folder size={16} />}
          detail={String(count(""))}
          selected={n.folder === ""}
          onSelect={() => n.setFolder("")}
        />
      </SidebarSection>
      <SidebarSection title="Folders">
        {n.folders.map((f) => (
          <div key={f} className="notes-folder">
            <SidebarItem
              label={f}
              icon={<Folder size={16} />}
              detail={String(count(f))}
              selected={n.folder === f}
              onSelect={() => n.setFolder(f)}
            />
            {count(f) === 0 && (
              <button
                type="button"
                className="notes-folder__delete nx-icon-button"
                aria-label={`Delete folder ${f}`}
                onClick={() =>
                  void call("notes_folder_delete", { name: f }).then(() => {
                    if (n.folder === f) n.setFolder("all")
                    return n.refresh()
                  })
                }
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="notes-new-folder" onClick={() => setNewFolder(true)}>
          <FolderPlus size={14} /> New Folder
        </button>
      </SidebarSection>
    </Sidebar>
  )

  const list = hits
    ? hits.map((h) => (
        <NoteRow
          key={h.note.path}
          note={h.note}
          snippet={h.snippet}
          selected={h.note.path === n.open?.path}
          onSelect={() => void n.select(h.note.path)}
        />
      ))
    : n.visible.map((note) => (
        <NoteRow
          key={note.path}
          note={note}
          selected={note.path === n.open?.path}
          onSelect={() => void n.select(note.path)}
        />
      ))

  return (
    <Window sidebar={sidebar} sidebarWidth={210}>
      <Toolbar
        title=""
        actions={
          <>
            {aiBusy && (
              <span className="notes-busy">
                <Spinner size={12} /> {aiBusy}…
              </span>
            )}
            {n.open && (
              <>
                <Select
                  aria-label="Folder"
                  title="Move to folder"
                  value={openMeta?.folder ?? ""}
                  options={folderOptions}
                  onChange={(f) => void n.move(n.open!.path, f)}
                />
                <button
                  type="button"
                  className="nx-icon-button"
                  aria-label={openMeta?.pinned ? "Unpin" : "Pin"}
                  title={openMeta?.pinned ? "Unpin" : "Pin"}
                  onClick={() => void n.setPinned(n.open!.path, !openMeta?.pinned)}
                >
                  {openMeta?.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <Popover
                  open={aiOpen}
                  onClose={() => setAiOpen(false)}
                  align="end"
                  anchor={
                    <button
                      type="button"
                      className="nx-icon-button"
                      aria-label="Assistant"
                      aria-expanded={aiOpen}
                      title="Assistant"
                      disabled={aiBusy !== null}
                      onClick={() => setAiOpen((v) => !v)}
                    >
                      <Sparkles size={16} />
                    </button>
                  }
                >
                  <div className="notes-menu" role="menu">
                    <button type="button" role="menuitem" onClick={summarize}>
                      Summarize
                    </button>
                    <button type="button" role="menuitem" onClick={continueWriting}>
                      Continue Writing
                    </button>
                    <div className="notes-menu__label">
                      Rewrite {editor.current?.selection() ? "selection" : "note"}
                    </div>
                    {TONES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        role="menuitem"
                        onClick={() => rewrite(t.tone)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </Popover>
                <button
                  type="button"
                  className="nx-icon-button"
                  aria-label="Delete note"
                  title="Delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="nx-icon-button"
              aria-label="New note"
              title="New Note"
              onClick={() => void n.create()}
            >
              <SquarePen size={16} />
            </button>
          </>
        }
      />
      <div className="notes-body">
        <div className="notes-list">
          <div className="notes-list__head">
            <SearchField value={query} onChange={setQuery} placeholder="Search notes" />
            <Button
              size="small"
              onClick={() => setAsking(true)}
              title="Ask a question about your notes"
            >
              <Sparkles size={12} /> Ask
            </Button>
          </div>
          <div className="notes-list__rows" role="list">
            {!n.loaded ? (
              <EmptyState title="Loading…" />
            ) : list.length === 0 ? (
              <EmptyState title={hits ? "No results" : "No notes"}>
                {!hits && (
                  <Button size="small" onClick={() => void n.create()}>
                    New Note
                  </Button>
                )}
              </EmptyState>
            ) : (
              list
            )}
          </div>
        </div>
        <div className="notes-pane">
          {n.error && (
            <Callout
              tone="danger"
              action={
                <Button size="small" onClick={n.clearError}>
                  OK
                </Button>
              }
            >
              {n.error}
            </Callout>
          )}
          {aiNotice && (
            <div className="notes-notice" role="status">
              {aiNotice}
              <button
                type="button"
                className="nx-icon-button"
                aria-label="Dismiss"
                onClick={() => setAiNotice(null)}
              >
                <X size={12} />
              </button>
            </div>
          )}
          {n.open ? (
            <>
              <div className="notes-pane__date">
                {openMeta &&
                  new Date(openMeta.modified).toLocaleString(undefined, {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
              </div>
              <Editor
                docKey={String(n.open.docKey)}
                value={n.open.text}
                onChange={n.edit}
                onReady={(h) => (editor.current = h)}
              />
            </>
          ) : (
            <EmptyState
              icon={<NotebookText size={40} />}
              title={n.loaded && n.notes.length === 0 ? "No notes yet" : "No note selected"}
            >
              <Button onClick={() => void n.create()}>New Note</Button>
            </EmptyState>
          )}
        </div>
      </div>

      {summary !== null && (
        <Sheet
          open
          onClose={() => setSummary(null)}
          title="Summary"
          width={520}
          actions={
            <>
              <Button onClick={() => void navigator.clipboard?.writeText(summary)}>Copy</Button>
              <Button onClick={() => setSummary(null)}>Close</Button>
              <Button variant="primary" onClick={insertSummary}>
                Insert in Note
              </Button>
            </>
          }
        >
          <div className="notes-summary">{summary}</div>
        </Sheet>
      )}
      {confirmDelete && n.open && (
        <Sheet
          open
          onClose={() => setConfirmDelete(false)}
          title={`Delete “${openMeta?.title ?? "this note"}”?`}
          actions={
            <>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const path = n.open!.path
                  setConfirmDelete(false)
                  void n.remove(path)
                }}
              >
                Move to Trash
              </Button>
            </>
          }
        >
          The note moves to the Trash. You can restore it from Files.
        </Sheet>
      )}
      {newFolder && (
        <NewFolderSheet
          onClose={() => setNewFolder(false)}
          onCreate={async (name) => {
            await call("notes_folder_create", { name })
            await n.refresh()
            n.setFolder(name)
          }}
        />
      )}
      {asking && <AskSheet onClose={() => setAsking(false)} onOpen={(p) => void n.select(p)} />}
    </Window>
  )
}
