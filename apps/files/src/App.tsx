import { assistant, call, type Drive, type FileEntry, type Place } from "@helixos/sdk"
import { useAppTheme, useCommand } from "@helixos/sdk/react"
import {
  Button,
  Callout,
  cx,
  EmptyState,
  SearchField,
  SegmentedControl,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Spinner,
  Toolbar,
  Window,
} from "@helixos/ui"
import {
  ChevronRight,
  Download,
  Eject,
  FileText,
  FolderPlus,
  Home,
  Image,
  LayoutGrid,
  List,
  Monitor,
  Music,
  Sparkles,
  Trash2,
  Usb,
  Video,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { FileIcon } from "./FileIcon"
import {
  breadcrumbs,
  formatDate,
  formatSize,
  KIND_LABELS,
  parentPath,
  parseNaturalQuery,
  rangeSelect,
  searchFromAssistant,
  sortEntries,
  type SortKey,
} from "./logic"
import { QuickLook } from "./QuickLook"
import { transfer } from "./transfer"
import { TrashView } from "./TrashView"
import { useBrowser, type Location } from "./useBrowser"

const PLACE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  desktop: Monitor,
  documents: FileText,
  downloads: Download,
  pictures: Image,
  music: Music,
  videos: Video,
}

type View = "list" | "icons"

interface MenuState {
  x: number
  y: number
  /** null: the menu for the folder background. */
  entry: FileEntry | null
}

function ContextMenu({
  menu,
  items,
  onClose,
}: {
  menu: MenuState
  items: ({ label: string; run: () => void; danger?: boolean } | "-")[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", key)
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus()
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", key)
    }
  }, [onClose])
  const left = Math.min(menu.x, window.innerWidth - 220)
  const top = Math.min(menu.y, window.innerHeight - items.length * 30 - 16)
  return (
    <div ref={ref} className="files-menu" role="menu" style={{ left, top }}>
      {items.map((item, i) =>
        item === "-" ? (
          <div key={i} className="files-menu__sep" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cx(item.danger && "files-menu__danger")}
            onClick={() => {
              onClose()
              item.run()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}

function RenameField({
  entry,
  onDone,
}: {
  entry: FileEntry
  onDone: (name: string | null) => void
}) {
  const [name, setName] = useState(entry.name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    // Select the name without the extension, like Finder.
    const dot = entry.kind === "folder" ? -1 : entry.name.lastIndexOf(".")
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
  }, [entry])
  return (
    <input
      ref={ref}
      className="files-rename"
      aria-label="New name"
      value={name}
      onChange={(e) => setName(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") onDone(name.trim() && name !== entry.name ? name.trim() : null)
        if (e.key === "Escape") onDone(null)
      }}
      onBlur={() => onDone(name.trim() && name !== entry.name ? name.trim() : null)}
    />
  )
}

export function App() {
  useAppTheme()
  const places = useCommand("files_places")
  const drives = useCommand("files_drives", undefined, { refreshMs: 5000 })
  const home = places.data?.find((p) => p.id === "home")?.path
  if (!home) {
    return (
      <Window>
        <Toolbar title="Files" />
        {places.error ? (
          <Callout tone="danger">{places.error}</Callout>
        ) : (
          <EmptyState title="Loading…" />
        )}
      </Window>
    )
  }
  return (
    <Browser
      home={home}
      places={places.data!}
      drives={drives.data ?? []}
      reloadDrives={drives.reload}
    />
  )
}

function Browser({
  home,
  places,
  drives,
  reloadDrives,
}: {
  home: string
  places: Place[]
  drives: Drive[]
  reloadDrives: () => Promise<void>
}) {
  const b = useBrowser(home)
  const [view, setView] = useState<View>("list")
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "name",
    ascending: true,
  })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [quickLook, setQuickLook] = useState<FileEntry | null>(null)
  const [query, setQuery] = useState("")
  const [smart, setSmart] = useState(false)
  const [searching, setSearching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [emptyTrash, setEmptyTrash] = useState(false)
  const pane = useRef<HTMLDivElement>(null)

  const folderPath =
    b.location.kind === "folder"
      ? b.location.path
      : b.location.kind === "search"
        ? b.location.root
        : home
  const sorted = useMemo(() => sortEntries(b.entries, sort.key, sort.ascending), [b.entries, sort])
  const selectedEntries = sorted.filter((e) => b.selected.includes(e.path))

  // Leaving the results (the sidebar, Back) clears the search box.
  useEffect(() => {
    if (b.location.kind !== "search") setQuery("")
  }, [b.location])

  const flash = (text: string) => {
    setNotice(text)
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 3000)
  }
  const fail = (e: unknown) => b.setError(e instanceof Error ? e.message : String(e))

  const open = async (entry: FileEntry) => {
    if (entry.kind === "folder") b.go({ kind: "folder", path: entry.path })
    else await call("files_open", { path: entry.path }).catch(fail)
  }

  const trash = async (paths: string[]) => {
    if (paths.length === 0) return
    try {
      await call("files_trash", { paths })
      flash(
        paths.length === 1 ? "Moved to the Trash." : `Moved ${paths.length} items to the Trash.`,
      )
      await b.reload()
      if (b.location.kind === "search")
        b.setEntries((list) => list.filter((e) => !paths.includes(e.path)))
    } catch (e) {
      fail(e)
    }
  }

  const paste = async () => {
    if (!b.clipboard || b.location.kind !== "folder") return
    try {
      const done = await transfer(b.clipboard.paths, b.location.path, b.clipboard.cut)
      if (b.clipboard.cut) b.setClipboard(null)
      await b.reload()
      b.setSelected(done)
    } catch (e) {
      fail(e)
    }
  }

  const newFolder = async () => {
    if (b.location.kind !== "folder") return
    try {
      const created = await call("files_create_folder", {
        dir: b.location.path,
        name: "New Folder",
      })
      await b.reload()
      b.setSelected([created.path])
      setRenaming(created.path)
    } catch (e) {
      fail(e)
    }
  }

  const finishRename = async (entry: FileEntry, name: string | null) => {
    setRenaming(null)
    pane.current?.focus()
    if (!name) return
    try {
      const renamed = await call("files_rename", { path: entry.path, name })
      await b.reload()
      b.setSelected([renamed.path])
    } catch (e) {
      fail(e)
    }
  }

  const runSearch = async () => {
    const text = query.trim()
    if (!text) return b.go({ kind: "folder", path: folderPath })
    setSearching(true)
    try {
      let search = parseNaturalQuery(text)
      if (smart) {
        const today = new Date().toISOString().slice(0, 10)
        try {
          const reply = await assistant.complete(
            "extract",
            `Today is ${today}. Find files: ${text}`,
            {
              fields: ["keywords", "kind", "after", "before"],
            },
          )
          search = searchFromAssistant(reply, search)
        } catch {
          flash("The assistant isn’t available; searching by name.")
        }
      }
      const results = await call("files_search", { root: folderPath, query: search, limit: 200 })
      b.go({ kind: "search", label: text, root: folderPath })
      b.setEntries(results)
    } catch (e) {
      fail(e)
    } finally {
      setSearching(false)
    }
  }

  const select = (entry: FileEntry, e: MouseEvent) => {
    if (e.shiftKey)
      b.setSelected(
        rangeSelect(
          sorted.map((x) => x.path),
          b.anchor,
          entry.path,
        ),
      )
    else if (e.ctrlKey || e.metaKey) {
      b.setSelected((s) =>
        s.includes(entry.path) ? s.filter((p) => p !== entry.path) : [...s, entry.path],
      )
      b.setAnchor(entry.path)
    } else {
      b.setSelected([entry.path])
      b.setAnchor(entry.path)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (renaming || quickLook) return
    const paths = sorted.map((x) => x.path)
    const current = b.selected[b.selected.length - 1]
    const index = current ? paths.indexOf(current) : -1
    const step =
      view === "icons" ? Math.max(1, Math.floor((pane.current?.clientWidth ?? 600) / 112)) : 1
    const move = (to: number) => {
      const target = paths[Math.max(0, Math.min(paths.length - 1, to))]
      if (!target) return
      b.setSelected(e.shiftKey ? rangeSelect(paths, b.anchor, target) : [target])
      if (!e.shiftKey) b.setAnchor(target)
      document
        .querySelector(`[data-path="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    }
    const ctrl = e.ctrlKey || e.metaKey
    // Alt+arrows navigate (Back, enclosing folder) and must be checked before plain arrows.
    if (e.altKey && e.key === "ArrowUp") {
      if (b.location.kind === "folder") b.go({ kind: "folder", path: parentPath(b.location.path) })
    } else if ((e.altKey && e.key === "ArrowLeft") || e.key === "Backspace") b.back?.()
    else if (e.altKey && e.key === "ArrowRight") b.forward?.()
    else if (e.key === "ArrowDown") move(index + (view === "icons" ? step : 1))
    else if (e.key === "ArrowUp") move(index - (view === "icons" ? step : 1))
    else if (e.key === "ArrowRight" && view === "icons") move(index + 1)
    else if (e.key === "ArrowLeft" && view === "icons") move(index - 1)
    else if (e.key === "Enter" && selectedEntries.length === 1) void open(selectedEntries[0]!)
    else if (e.key === "F2" && selectedEntries.length === 1) setRenaming(selectedEntries[0]!.path)
    else if (e.key === " " && selectedEntries.length === 1) setQuickLook(selectedEntries[0]!)
    else if (e.key === "Delete") void trash(b.selected)
    else if (ctrl && e.key.toLowerCase() === "a") b.setSelected(paths)
    else if (ctrl && e.key.toLowerCase() === "c" && b.selected.length) {
      b.setClipboard({ paths: b.selected, cut: false })
      flash(`Copied ${b.selected.length === 1 ? "1 item" : `${b.selected.length} items`}.`)
    } else if (ctrl && e.key.toLowerCase() === "x" && b.selected.length) {
      b.setClipboard({ paths: b.selected, cut: true })
      flash("Paste to move.")
    } else if (ctrl && e.key.toLowerCase() === "v") void paste()
    else if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") void newFolder()
    else if (ctrl && e.key.toLowerCase() === "h") b.setShowHidden((v) => !v)
    else if (ctrl && e.key.toLowerCase() === "f")
      document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    else return
    e.preventDefault()
  }

  const menuItems = (entry: FileEntry | null) => {
    if (!entry) {
      return [
        { label: "New Folder", run: () => void newFolder() },
        ...(b.clipboard
          ? [{ label: b.clipboard.cut ? "Move Here" : "Paste", run: () => void paste() }]
          : []),
        "-" as const,
        {
          label: b.showHidden ? "Hide Hidden Files" : "Show Hidden Files",
          run: () => b.setShowHidden((v) => !v),
        },
      ]
    }
    const targets = b.selected.includes(entry.path) ? b.selected : [entry.path]
    return [
      { label: "Open", run: () => void open(entry) },
      ...(entry.kind !== "folder" ? [{ label: "Quick Look", run: () => setQuickLook(entry) }] : []),
      "-" as const,
      { label: "Rename", run: () => setRenaming(entry.path) },
      { label: "Copy", run: () => b.setClipboard({ paths: targets, cut: false }) },
      { label: "Cut", run: () => b.setClipboard({ paths: targets, cut: true }) },
      ...(b.clipboard && entry.kind === "folder"
        ? [
            {
              label: "Paste Into Folder",
              run: () =>
                void transfer(b.clipboard!.paths, entry.path, b.clipboard!.cut)
                  .then(() => b.reload())
                  .catch(fail),
            },
          ]
        : []),
      ...(b.location.kind === "search"
        ? [
            {
              label: "Show in Folder",
              run: () => b.go({ kind: "folder", path: parentPath(entry.path) }),
            },
          ]
        : []),
      "-" as const,
      { label: "Move to Trash", run: () => void trash(targets), danger: true },
    ]
  }

  const mountAndOpen = async (drive: Drive) => {
    try {
      const mountPoint = drive.mount_point ?? (await call("files_mount", { device: drive.device }))
      await reloadDrives()
      b.go({ kind: "folder", path: mountPoint })
    } catch (e) {
      fail(e)
    }
  }

  const eject = async (drive: Drive) => {
    try {
      if (
        b.location.kind === "folder" &&
        drive.mount_point &&
        b.location.path.startsWith(drive.mount_point)
      ) {
        b.go({ kind: "folder", path: home })
      }
      await call("files_eject", { device: drive.device, powerOff: drive.removable })
      await reloadDrives()
      flash(`“${drive.name}” can be removed now.`)
    } catch (e) {
      fail(e)
    }
  }

  const isAt = (loc: Location) => JSON.stringify(loc) === JSON.stringify(b.location)

  const sidebar = (
    <Sidebar>
      <SidebarSection title="Favorites">
        {places.map((p) => {
          const Icon = PLACE_ICONS[p.id] ?? FileText
          return (
            <SidebarItem
              key={p.path}
              label={p.name}
              icon={<Icon size={16} />}
              selected={isAt({ kind: "folder", path: p.path })}
              onSelect={() => b.go({ kind: "folder", path: p.path })}
            />
          )
        })}
      </SidebarSection>
      {drives.length > 0 && (
        <SidebarSection title="Locations">
          {drives.map((d) => (
            <div key={d.device} className="files-drive">
              <SidebarItem
                label={d.name}
                icon={<Usb size={16} />}
                selected={!!d.mount_point && isAt({ kind: "folder", path: d.mount_point })}
                onSelect={() => void mountAndOpen(d)}
              />
              {d.mount_point && (
                <button
                  type="button"
                  className="nx-icon-button files-drive__eject"
                  aria-label={`Eject ${d.name}`}
                  title="Eject"
                  onClick={() => void eject(d)}
                >
                  <Eject size={13} />
                </button>
              )}
            </div>
          ))}
        </SidebarSection>
      )}
      <SidebarSection>
        <SidebarItem
          label="Trash"
          icon={<Trash2 size={16} />}
          selected={b.location.kind === "trash"}
          onSelect={() => b.go({ kind: "trash" })}
        />
      </SidebarSection>
    </Sidebar>
  )

  const title =
    b.location.kind === "trash"
      ? "Trash"
      : b.location.kind === "search"
        ? `Results for “${b.location.label}”`
        : (breadcrumbs(b.location.path, home).at(-1)?.name ?? "Files")

  const header = (key: SortKey, label: string) => (
    <th
      aria-sort={sort.key === key ? (sort.ascending ? "ascending" : "descending") : "none"}
      onClick={() =>
        setSort((s) => ({ key, ascending: s.key === key ? !s.ascending : key === "name" }))
      }
    >
      {label}
      {sort.key === key && <span className="files-sort">{sort.ascending ? "▲" : "▼"}</span>}
    </th>
  )

  const itemProps = (entry: FileEntry) => ({
    "data-path": entry.path,
    "aria-selected": b.selected.includes(entry.path),
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      select(entry, e)
    },
    onDoubleClick: () => void open(entry),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!b.selected.includes(entry.path)) b.setSelected([entry.path])
      setMenu({ x: e.clientX, y: e.clientY, entry })
    },
  })

  const cutPaths = b.clipboard?.cut ? b.clipboard.paths : []

  return (
    <Window sidebar={sidebar} sidebarWidth={200}>
      <Toolbar
        title={title}
        showHistory
        onBack={b.back}
        onForward={b.forward}
        actions={
          <>
            {b.location.kind === "trash" ? (
              <Button size="small" onClick={() => setEmptyTrash(true)}>
                Empty Trash
              </Button>
            ) : (
              <>
                <SegmentedControl
                  label="View"
                  value={view}
                  onChange={setView}
                  options={[
                    {
                      value: "icons",
                      label: <LayoutGrid size={14} aria-label="Icons" />,
                      title: "Icons",
                    },
                    { value: "list", label: <List size={14} aria-label="List" />, title: "List" },
                  ]}
                />
                <button
                  type="button"
                  className="nx-icon-button"
                  aria-label="New folder"
                  title="New Folder (Ctrl+Shift+N)"
                  disabled={b.location.kind !== "folder"}
                  onClick={() => void newFolder()}
                >
                  <FolderPlus size={16} />
                </button>
              </>
            )}
            <form
              className="files-search"
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch()
              }}
            >
              <SearchField
                value={query}
                onChange={(v) => (
                  setQuery(v),
                  !v && b.location.kind === "search" && b.go({ kind: "folder", path: folderPath })
                )}
                placeholder={smart ? "Describe what you’re looking for" : "Search"}
              />
              <button
                type="button"
                className={cx("nx-icon-button", smart && "files-smart--on")}
                aria-pressed={smart}
                aria-label="Search with the assistant"
                title="Search with the assistant: “the pdf about taxes from March”"
                onClick={() => setSmart((v) => !v)}
              >
                <Sparkles size={15} />
              </button>
            </form>
          </>
        }
      />
      {b.location.kind === "folder" && (
        <nav className="files-path" aria-label="Path">
          {breadcrumbs(b.location.path, home).map((c, i, all) => (
            <span key={c.path} className="files-path__part">
              <button
                type="button"
                onClick={() => b.go({ kind: "folder", path: c.path })}
                aria-current={i === all.length - 1 ? "location" : undefined}
              >
                {c.name}
              </button>
              {i < all.length - 1 && <ChevronRight size={12} />}
            </span>
          ))}
        </nav>
      )}
      {b.error && (
        <div className="files-banner">
          <Callout
            tone="danger"
            action={
              <Button size="small" onClick={() => b.setError(null)}>
                OK
              </Button>
            }
          >
            {b.error}
          </Callout>
        </div>
      )}
      {b.location.kind === "trash" ? (
        <TrashView emptyRequested={emptyTrash} onEmptied={() => setEmptyTrash(false)} />
      ) : (
        <div
          ref={pane}
          className="files-pane"
          tabIndex={0}
          role={view === "list" ? "grid" : "listbox"}
          aria-multiselectable="true"
          aria-label={title}
          onKeyDown={onKey}
          onClick={() => b.setSelected([])}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, entry: null })
          }}
        >
          {searching ? (
            <EmptyState
              icon={<Spinner size={24} />}
              title={smart ? "Asking the assistant…" : "Searching…"}
            />
          ) : sorted.length === 0 ? (
            <EmptyState
              title={
                b.loading
                  ? "Loading…"
                  : b.location.kind === "search"
                    ? "No results"
                    : "This folder is empty"
              }
            />
          ) : view === "list" ? (
            <table className="files-table">
              <thead>
                <tr>
                  {header("name", "Name")}
                  {header("modified", "Date Modified")}
                  {header("size", "Size")}
                  {header("kind", "Kind")}
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr
                    key={entry.path}
                    {...itemProps(entry)}
                    className={cx(
                      cutPaths.includes(entry.path) && "files--cut",
                      entry.hidden && "files--hidden",
                    )}
                  >
                    <td className="files-table__name">
                      <FileIcon entry={entry} />
                      {renaming === entry.path ? (
                        <RenameField
                          entry={entry}
                          onDone={(name) => void finishRename(entry, name)}
                        />
                      ) : (
                        <span>{entry.name}</span>
                      )}
                    </td>
                    <td className="files-table__muted">{formatDate(entry.modified)}</td>
                    <td className="files-table__muted">{formatSize(entry.size, entry.kind)}</td>
                    <td className="files-table__muted">{KIND_LABELS[entry.kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="files-grid">
              {sorted.map((entry) => (
                <div
                  key={entry.path}
                  role="option"
                  tabIndex={-1}
                  {...itemProps(entry)}
                  className={cx(
                    "files-tile",
                    cutPaths.includes(entry.path) && "files--cut",
                    entry.hidden && "files--hidden",
                  )}
                >
                  <div className="files-tile__icon">
                    <FileIcon entry={entry} size={56} thumbnail />
                  </div>
                  {renaming === entry.path ? (
                    <RenameField entry={entry} onDone={(name) => void finishRename(entry, name)} />
                  ) : (
                    <span className="files-tile__name">{entry.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <footer className="files-status" role="status">
        {notice ??
          (b.location.kind === "trash"
            ? ""
            : b.selected.length > 0
              ? `${b.selected.length} of ${sorted.length} selected`
              : `${sorted.length} item${sorted.length === 1 ? "" : "s"}`)}
      </footer>
      {menu && (
        <ContextMenu menu={menu} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />
      )}
      {quickLook && (
        <QuickLook
          entry={quickLook}
          onClose={() => (setQuickLook(null), pane.current?.focus())}
          onOpen={() => {
            void open(quickLook)
            setQuickLook(null)
          }}
        />
      )}
    </Window>
  )
}
