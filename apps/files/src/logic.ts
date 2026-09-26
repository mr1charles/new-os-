/** Pure logic behind Files (no React, no backend), unit tested. */
import type { FileEntry, FileKind, FileSearch } from "@newos/sdk"

export function formatSize(bytes: number | null, kind: FileKind): string {
  if (bytes === null) return "—"
  if (kind === "folder") return bytes === 1 ? "1 item" : `${bytes} items`
  if (bytes < 1000) return `${bytes} bytes`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = -1
  do {
    value /= 1000
    unit++
  } while (value >= 1000 && unit < units.length - 1)
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** "Today at 3:04 PM", "Yesterday at 9:15 AM", "Mar 3, 2026 at 11:00 AM". */
export function formatDate(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return `Today at ${time}`
  if (date.toDateString() === new Date(now - 86_400_000).toDateString())
    return `Yesterday at ${time}`
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at ${time}`
}

export const KIND_LABELS: Record<FileKind, string> = {
  folder: "Folder",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF document",
  document: "Document",
  spreadsheet: "Spreadsheet",
  presentation: "Presentation",
  text: "Text",
  code: "Source code",
  archive: "Archive",
  app: "Application",
  other: "Document",
}

export type SortKey = "name" | "modified" | "size" | "kind"

/** Folders first, then by the chosen column (names in natural order). */
export function sortEntries(entries: FileEntry[], key: SortKey, ascending: boolean): FileEntry[] {
  const dir = ascending ? 1 : -1
  const byName = (a: FileEntry, b: FileEntry) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === "folder") - Number(a.kind === "folder")
    if (folders) return folders
    let order = 0
    if (key === "modified") order = a.modified - b.modified
    else if (key === "size") order = (a.size ?? -1) - (b.size ?? -1)
    else if (key === "kind") order = KIND_LABELS[a.kind].localeCompare(KIND_LABELS[b.kind])
    return (order || byName(a, b)) * (key === "name" ? dir : order ? dir : 1)
  })
}

export interface Crumb {
  name: string
  path: string
}

/** Breadcrumbs from home: "/home/a/Documents/Work" -> Home › Documents › Work. */
export function breadcrumbs(path: string, home: string): Crumb[] {
  const inHome = path === home || path.startsWith(`${home}/`)
  const base = inHome ? home : ""
  const rest = path.slice(base.length).split("/").filter(Boolean)
  const crumbs: Crumb[] = [inHome ? { name: "Home", path: home } : { name: "Computer", path: "/" }]
  let current = base
  for (const part of rest) {
    current = `${current}/${part}`
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

export function parentPath(path: string): string {
  const cut = path.replace(/\/+$/, "").lastIndexOf("/")
  return cut <= 0 ? "/" : path.slice(0, cut)
}

/** Selection with Shift: everything between the anchor and the clicked item. */
export function rangeSelect(paths: string[], anchor: string | null, target: string): string[] {
  const a = anchor ? paths.indexOf(anchor) : -1
  const b = paths.indexOf(target)
  if (a < 0 || b < 0) return [target]
  const [from, to] = a < b ? [a, b] : [b, a]
  return paths.slice(from, to + 1)
}

const KIND_WORDS: [RegExp, FileKind[]][] = [
  [/\bpdfs?\b/, ["pdf"]],
  [/\b(photos?|pictures?|images?|screenshots?|pics?)\b/, ["image"]],
  [/\b(videos?|movies?|clips?)\b/, ["video"]],
  [/\b(music|songs?|audio|podcasts?)\b/, ["audio"]],
  [/\b(spreadsheets?|sheets?|excel)\b/, ["spreadsheet"]],
  [/\b(presentations?|slides?|decks?)\b/, ["presentation"]],
  [/\b(documents?|docs?|letters?|reports?)\b/, ["document", "pdf", "text"]],
  [/\b(archives?|zips?)\b/, ["archive"]],
  [/\b(code|scripts?)\b/, ["code"]],
]
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]
const FILLER = new Set(
  "a an the my me find show get all about from in on of with that this for last files file and or named called".split(
    " ",
  ),
)

/**
 * Understand a plain request without the assistant: kinds ("pdf", "photos"), a month ("from
 * March"), or "today" / "yesterday" / "this week" / "last week" / "this month" / "this year";
 * the other words must appear in the name.
 */
export function parseNaturalQuery(input: string, now = new Date()): FileSearch {
  let q = ` ${input.toLowerCase()} `
  const kinds = new Set<FileKind>()
  for (const [pattern, k] of KIND_WORDS) {
    if (pattern.test(q)) {
      k.forEach((x) => kinds.add(x))
      q = q.replace(pattern, " ")
    }
  }
  let after: number | null = null
  let before: number | null = null
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const day = 86_400_000
  const relative: [RegExp, () => [number, number | null]][] = [
    [/\btoday\b/, () => [startOfDay(now), null]],
    [/\byesterday\b/, () => [startOfDay(now) - day, startOfDay(now)]],
    [/\bthis week\b/, () => [startOfDay(now) - ((now.getDay() + 6) % 7) * day, null]],
    [
      /\blast week\b/,
      () => [
        startOfDay(now) - (((now.getDay() + 6) % 7) + 7) * day,
        startOfDay(now) - ((now.getDay() + 6) % 7) * day,
      ],
    ],
    [/\bthis month\b/, () => [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), null]],
    [/\bthis year\b/, () => [new Date(now.getFullYear(), 0, 1).getTime(), null]],
  ]
  for (const [pattern, range] of relative) {
    if (pattern.test(q)) {
      ;[after, before] = range()
      q = q.replace(pattern, " ")
    }
  }
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(q))
  if (month >= 0 && after === null) {
    const year = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
    after = new Date(year, month, 1).getTime()
    before = new Date(year, month + 1, 1).getTime()
    q = q.replace(new RegExp(`\\b${MONTHS[month]}\\b`), " ")
  }
  const words = q
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
  return {
    words,
    kinds: [...kinds],
    modified_after: after,
    modified_before: before,
    contents: false,
  }
}

/**
 * The assistant's "extract" reply (fields: keywords, kind, after, before) as a search. Only
 * known kinds and valid dates are kept, so a confused reply degrades to a plain name search.
 */
export function searchFromAssistant(reply: string, fallback: FileSearch): FileSearch {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (!json) return fallback
  try {
    const data = JSON.parse(json) as Record<string, unknown>
    const words =
      typeof data.keywords === "string"
        ? data.keywords.split(/[\s,]+/).filter(Boolean)
        : Array.isArray(data.keywords)
          ? data.keywords.filter((w): w is string => typeof w === "string")
          : fallback.words
    const kindText = typeof data.kind === "string" ? data.kind.toLowerCase() : ""
    const kinds = kindText ? parseNaturalQuery(kindText).kinds : fallback.kinds
    const date = (v: unknown) => {
      if (typeof v !== "string" || !v) return null
      const t = Date.parse(v)
      return Number.isNaN(t) ? null : t
    }
    return {
      words: words.map((w) => w.toLowerCase()).filter((w) => !FILLER.has(w)),
      kinds,
      modified_after: date(data.after) ?? fallback.modified_after,
      modified_before: date(data.before) ?? fallback.modified_before,
      contents: false,
    }
  } catch {
    return fallback
  }
}
