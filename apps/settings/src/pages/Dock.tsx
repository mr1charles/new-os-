import type { DesktopEntry } from "@newos/sdk"
import { useCommand, useSettings } from "@newos/sdk/react"
import { Button, EmptyState, Group, Page, Row, SearchField, Sheet, Toggle } from "@newos/ui"
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"

/** Pinned ids are stored without ".desktop" (the shell accepts both). */
const bare = (id: string) => id.replace(/\.desktop$/, "")

function AddAppSheet({
  pinned,
  onAdd,
  onClose,
}: {
  pinned: string[]
  onAdd: (id: string) => void
  onClose: () => void
}) {
  const apps = useCommand("apps")
  const [query, setQuery] = useState("")
  const list = useMemo(() => {
    const q = query.toLowerCase()
    return (apps.data ?? [])
      .filter((a) => !pinned.includes(bare(a.id)))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [apps.data, pinned, query])
  return (
    <Sheet
      open
      onClose={onClose}
      title="Add to Dock"
      width={420}
      actions={<Button onClick={onClose}>Done</Button>}
    >
      <SearchField value={query} onChange={setQuery} autoFocus placeholder="Search apps" />
      <div className="settings-app-list">
        {list.length === 0 ? (
          <EmptyState title={apps.loading ? "Loading apps…" : "No apps"} />
        ) : (
          list.map((a) => (
            <Row key={a.id} label={a.name} description={bare(a.id)}>
              <Button size="small" onClick={() => onAdd(bare(a.id))}>
                Add
              </Button>
            </Row>
          ))
        )}
      </div>
    </Sheet>
  )
}

export function DockPage() {
  const [settings, update] = useSettings()
  const apps = useCommand("apps")
  const [adding, setAdding] = useState(false)
  const pinned = settings.dock.pinned.map(bare)
  const names = new Map((apps.data ?? []).map((a: DesktopEntry) => [bare(a.id), a.name]))

  const setPinned = (next: string[]) => void update({ dock: { pinned: next } })
  const move = (index: number, by: number) => {
    const next = [...pinned]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    setPinned(next)
  }

  return (
    <Page>
      <Group>
        <Row label="Magnification" description="Icons grow as the pointer moves over them.">
          <Toggle
            label="Magnification"
            checked={settings.dock.magnification}
            onChange={(v) => void update({ dock: { magnification: v } })}
          />
        </Row>
        <Row label="Show suggested and recent apps">
          <Toggle
            label="Show suggested and recent apps"
            checked={settings.dock.showRecents}
            onChange={(v) => void update({ dock: { showRecents: v } })}
          />
        </Row>
      </Group>
      <Group
        title="Apps in the Dock"
        titleAccessory={
          <Button size="small" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add App…
          </Button>
        }
        footer="Apps that are not installed yet stay in the list and appear once installed."
      >
        {pinned.length === 0 ? (
          <EmptyState title="The Dock has no pinned apps" />
        ) : (
          pinned.map((id, i) => (
            <Row
              key={id}
              label={names.get(id) ?? id}
              description={names.has(id) ? undefined : "Not installed"}
            >
              <button
                type="button"
                className="nx-icon-button"
                aria-label={`Move ${id} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                className="nx-icon-button"
                aria-label={`Move ${id} down`}
                disabled={i === pinned.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                className="nx-icon-button"
                aria-label={`Remove ${id} from the Dock`}
                onClick={() => setPinned(pinned.filter((p) => p !== id))}
              >
                <X size={14} />
              </button>
            </Row>
          ))
        )}
      </Group>
      {adding && (
        <AddAppSheet
          pinned={pinned}
          onAdd={(id) => setPinned([...pinned, id])}
          onClose={() => setAdding(false)}
        />
      )}
    </Page>
  )
}
