/** Icons and thumbnails for files: colored glyphs by kind, real previews for images and PDFs. */
import { call, inTauri, type FileEntry, type FileKind } from "@newos/sdk"
import {
  AppWindow,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  File as FileGeneric,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

const ICONS: Record<FileKind, [LucideIcon, string]> = {
  folder: [Folder, "#3b93f2"],
  image: [FileImage, "#e2574c"],
  video: [FileVideo, "#9b59d0"],
  audio: [FileAudio, "#ff2d55"],
  pdf: [FileText, "#e2574c"],
  document: [FileText, "#2b7cd3"],
  spreadsheet: [FileSpreadsheet, "#1f9d55"],
  presentation: [Presentation, "#f08a24"],
  text: [FileText, "#8e8e93"],
  code: [FileCode, "#5856d6"],
  archive: [FileArchive, "#a2845e"],
  app: [AppWindow, "#636366"],
  other: [FileGeneric, "#8e8e93"],
}

let convert: ((path: string) => string) | null = null
async function assetUrl(path: string): Promise<string | null> {
  if (!inTauri()) return null
  convert ??= (await import("@tauri-apps/api/core")).convertFileSrc
  return convert(path)
}

/** A URL to show the file's content as a picture, or null for a plain icon. */
export function useThumbnail(entry: FileEntry, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !inTauri()) return
    let cancelled = false
    const load = async () => {
      if (entry.kind === "image" && (entry.size ?? 0) < 40_000_000) return assetUrl(entry.path)
      if (entry.kind === "pdf")
        return assetUrl(await call("files_pdf_thumbnail", { path: entry.path }))
      return null
    }
    load()
      .then((u) => !cancelled && setUrl(u))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [entry.path, entry.kind, entry.size, entry.modified, enabled])
  return url
}

export function FileIcon({
  entry,
  size = 18,
  thumbnail = false,
}: {
  entry: FileEntry
  size?: number
  thumbnail?: boolean
}) {
  const url = useThumbnail(entry, thumbnail)
  if (url)
    return (
      <img
        className="files-thumb"
        src={url}
        alt=""
        draggable={false}
        style={{ maxWidth: size, maxHeight: size }}
      />
    )
  const [Icon, color] = ICONS[entry.kind]
  return (
    <Icon
      size={size}
      color={color}
      strokeWidth={entry.kind === "folder" ? 1.6 : 1.5}
      fill={entry.kind === "folder" ? `${color}33` : "none"}
      aria-hidden="true"
    />
  )
}

export function kindIcon(kind: FileKind): [LucideIcon, string] {
  return ICONS[kind]
}
