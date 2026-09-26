/** The Trash: what was deleted and from where, with Restore and Empty Trash. */
import { call, type TrashItem } from "@newos/sdk"
import { Button, Callout, EmptyState, Sheet } from "@newos/ui"
import { Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { FileIcon } from "./FileIcon"
import { formatSize } from "./logic"

export function TrashView({
  emptyRequested,
  onEmptied,
}: {
  emptyRequested: boolean
  onEmptied: () => void
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    call("files_trash_list")
      .then((list) => {
        setItems(list)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  const restore = async (id: string) => {
    try {
      await call("files_trash_restore", { id })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (items === null) return <EmptyState title="Loading…" />
  return (
    <div className="files-trash">
      {error && <Callout tone="danger">{error}</Callout>}
      {items.length === 0 ? (
        <EmptyState icon={<Trash2 size={40} />} title="The Trash is empty" />
      ) : (
        <table className="files-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Original location</th>
              <th>Deleted</th>
              <th>Size</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="files-table__name">
                  <FileIcon
                    entry={{
                      name: item.name,
                      path: "",
                      kind: item.kind,
                      size: item.size,
                      modified: 0,
                      hidden: false,
                      symlink: false,
                    }}
                  />
                  <span>{item.name}</span>
                </td>
                <td className="files-table__muted">
                  {item.original_path.slice(0, item.original_path.lastIndexOf("/")) || "/"}
                </td>
                <td className="files-table__muted">
                  {item.deleted.replace("T", " ").slice(0, 16)}
                </td>
                <td className="files-table__muted">
                  {item.size === null ? "—" : formatSize(item.size, item.kind)}
                </td>
                <td>
                  <Button size="small" onClick={() => void restore(item.id)}>
                    Put Back
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {emptyRequested && (
        <Sheet
          open
          onClose={onEmptied}
          title="Empty the Trash?"
          actions={
            <>
              <Button onClick={onEmptied}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await call("files_trash_empty")
                  } finally {
                    onEmptied()
                    load()
                  }
                }}
              >
                Empty Trash
              </Button>
            </>
          }
        >
          {items.length} item{items.length === 1 ? "" : "s"} will be deleted forever. You can’t undo
          this.
        </Sheet>
      )}
    </div>
  )
}
