import type { BarPosition, DesktopEntry, DockPosition, DockStyle } from "@helixos/sdk"
import { useCommand, useSettings } from "@helixos/sdk/react"
import {
  Button,
  EmptyState,
  Group,
  Page,
  Row,
  SearchField,
  SegmentedControl,
  Sheet,
  Slider,
  Toggle,
} from "@helixos/ui"
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

  const taskbar = settings.dock.style === "taskbar"
  const [iconSize, setIconSize] = useState(settings.dock.iconSize)
  return (
    <Page>
      <Group
        footer={
          taskbar
            ? "The taskbar holds Start, your apps, and the clock and status icons, like Windows. The menu bar is hidden."
            : undefined
        }
      >
        <Row label="Style">
          <SegmentedControl<DockStyle>
            label="Dock style"
            value={settings.dock.style}
            options={[
              { value: "dock", label: "Dock" },
              { value: "taskbar", label: "Taskbar" },
            ]}
            onChange={(style) => void update({ dock: { style } })}
          />
        </Row>
        {!taskbar && (
          <Row label="Position on screen">
            <SegmentedControl<DockPosition>
              label="Dock position"
              value={settings.dock.position}
              options={[
                { value: "left", label: "Left" },
                { value: "bottom", label: "Bottom" },
                { value: "right", label: "Right" },
              ]}
              onChange={(position) => void update({ dock: { position } })}
            />
          </Row>
        )}
        {!taskbar && (
          <Row label="Menu bar">
            <SegmentedControl<BarPosition>
              label="Menu bar position"
              value={settings.bar.position}
              options={[
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
              ]}
              onChange={(position) => void update({ bar: { position } })}
            />
          </Row>
        )}
        <Row label="Size">
          <Slider
            label="Icon size"
            value={iconSize}
            min={28}
            max={72}
            step={2}
            start="Small"
            end="Large"
            onChange={setIconSize}
            onCommit={(size) => void update({ dock: { iconSize: size } })}
          />
        </Row>
      </Group>
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
