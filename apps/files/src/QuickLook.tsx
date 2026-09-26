/** Quick Look: Space shows a preview of the selected file, with Open and Summarize. */
import { assistant, call, type FileEntry } from "@helixos/sdk"
import { Button, Callout, Sheet, Spinner } from "@helixos/ui"
import { Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { FileIcon, useThumbnail } from "./FileIcon"
import { formatDate, formatSize, KIND_LABELS } from "./logic"

const SUMMARIZABLE = new Set(["pdf", "text", "code", "document"])

export function QuickLook({
  entry,
  onClose,
  onOpen,
}: {
  entry: FileEntry
  onClose: () => void
  onOpen: () => void
}) {
  const picture = useThumbnail(entry, true)
  const [text, setText] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (entry.kind === "text" || entry.kind === "code") {
      call("files_preview_text", { path: entry.path })
        .then(setText)
        .catch(() => setText(null))
    }
  }, [entry.path, entry.kind])

  const summarize = async () => {
    setBusy(true)
    setError(null)
    try {
      const content = await call("files_document_text", { path: entry.path })
      if (!content?.trim()) throw new Error("There’s no text in this file to summarize.")
      setSummary(await assistant.complete("summarize", content))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={entry.name}
      width={640}
      actions={
        <>
          {SUMMARIZABLE.has(entry.kind) && (
            <Button disabled={busy} onClick={() => void summarize()}>
              {busy ? <Spinner size={12} /> : <Sparkles size={12} />} Summarize
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onOpen}>
            Open
          </Button>
        </>
      }
    >
      <div className="files-ql">
        {picture ? (
          <img className="files-ql__image" src={picture} alt={entry.name} />
        ) : text !== null ? (
          <pre className="files-ql__text">{text}</pre>
        ) : (
          <div className="files-ql__icon">
            <FileIcon entry={entry} size={96} />
          </div>
        )}
        <div className="files-ql__info">
          {KIND_LABELS[entry.kind]} · {formatSize(entry.size, entry.kind)} · Modified{" "}
          {formatDate(entry.modified)}
        </div>
        {summary && <div className="files-ql__summary">{summary}</div>}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Sheet>
  )
}
