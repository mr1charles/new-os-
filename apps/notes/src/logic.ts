/** Pure logic behind Notes, kept apart from React and CodeMirror so it is unit tested. */

/** Checklist markers: "- [ ] " and "- [x] " (also "*" bullets), at the start of a line. */
export const CHECKBOX = /^(\s*[-*] )\[( |x|X)\] /

/** Position of the mark character inside "[ ]" for a line, or null if it is not a task. */
export function checkboxMark(line: string): number | null {
  const m = CHECKBOX.exec(line)
  return m ? m[1]!.length + 1 : null
}

/** The line with its checkbox flipped. */
export function toggleCheckbox(line: string): string {
  const at = checkboxMark(line)
  if (at === null) return line
  const checked = line[at] !== " "
  return line.slice(0, at) + (checked ? " " : "x") + line.slice(at + 1)
}

/** Everything after the title line, which AI actions work on when nothing is selected. */
export function bodyRange(text: string): { from: number; to: number } {
  const firstLineEnd = text.indexOf("\n")
  if (firstLineEnd === -1) return { from: text.length, to: text.length }
  let from = firstLineEnd + 1
  while (text[from] === "\n") from++
  return { from, to: text.length }
}

const STOP_WORDS = new Set(
  "a an and are as at be but by can did do does for from had has have how i in is it its me my of on or our so that the their them there these they this to was we were what when where which who why will with you your about into just like than then".split(
    " ",
  ),
)

/** Words worth searching for in a question: "What did I plan for Q4?" -> ["plan", "q4"]. */
export function keywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
  return [...new Set(words)].slice(0, 8)
}

export interface Source {
  title: string
  path: string
  text: string
}

/** Rank notes by how many keywords matched them (from one search per keyword). */
export function rankSources(matchesPerKeyword: string[][], limit = 5): string[] {
  const counts = new Map<string, number>()
  for (const paths of matchesPerKeyword) {
    paths.forEach((path, i) =>
      counts.set(path, (counts.get(path) ?? 0) + 1 + (paths.length - i) / (100 * paths.length)),
    )
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path]) => path)
}

/** The message sent to the assistant for "Ask my notes": the question grounded in notes. */
export function askPrompt(question: string, sources: Source[], maxChars = 2500): string {
  const blocks = sources.map(
    (s, i) =>
      `<note index="${i + 1}" title="${s.title.replace(/"/g, "'")}">\n${s.text.slice(0, maxChars)}\n</note>`,
  )
  return [
    "Answer my question using only the notes below. Mention which note (by title) each fact comes from.",
    "If the notes do not contain the answer, say so plainly.",
    "",
    ...blocks,
    "",
    `Question: ${question}`,
  ].join("\n")
}

/** "2 min ago", "Yesterday", "Sep 3", "Sep 3, 2025": the list's date column. */
export function shortDate(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const diff = now - ms
  if (diff < 60_000) return "Just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  const yesterday = new Date(now - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  const sameYear = date.getFullYear() === today.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}
