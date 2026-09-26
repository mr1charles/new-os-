/** Pure logic behind Terminal (no xterm, no React), unit tested. */

export interface Risk {
  level: "danger" | "caution"
  reason: string
}

const RISKS: [RegExp, Risk][] = [
  [
    /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|-rf|-fr)\b.*(\s\/(\s|$)|\s~\/?(\s|$)|\s\*|\s\.\.?\/?(\s|$))/i,
    { level: "danger", reason: "Deletes a whole folder tree without asking." },
  ],
  [
    /\bmkfs(\.\w+)?\b|\bwipefs\b|\bsgdisk\b.*--zap|\bfdisk\b|\bparted\b/,
    { level: "danger", reason: "Changes disk partitions or formats a disk." },
  ],
  [/\bdd\b[^|]*\bof=\/dev\//, { level: "danger", reason: "Writes directly over a disk device." }],
  [
    />\s*\/dev\/(sd|nvme|mmcblk)/,
    { level: "danger", reason: "Writes directly over a disk device." },
  ],
  [
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
    { level: "danger", reason: "A fork bomb: it freezes the computer." },
  ],
  [
    /\bchmod\s+(-R\s+)?[0-7]*777\s+\/(\s|$)|\bchown\s+-R\b.*\s\/(\s|$)/,
    { level: "danger", reason: "Changes permissions on the whole system." },
  ],
  [
    /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b|\bwget\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    { level: "caution", reason: "Runs a script straight from the internet." },
  ],
  [/\brm\b\s+-[a-z]*r/i, { level: "caution", reason: "Deletes folders and everything in them." }],
  [/\bsudo\b/, { level: "caution", reason: "Runs with administrator rights." }],
  [
    /\bsystemctl\s+(stop|disable|mask)\b|\bkillall\b|\bpkill\b/,
    { level: "caution", reason: "Stops running programs or services." },
  ],
  [
    /\bgit\s+(push\s+.*--force|reset\s+--hard|clean\s+-[a-z]*f)/,
    { level: "caution", reason: "Discards work in a git repository." },
  ],
]

/** Why a command deserves a second look before running it, or null. The first match wins. */
export function assessCommand(command: string): Risk | null {
  for (const [pattern, risk] of RISKS) if (pattern.test(command)) return risk
  return null
}

/** Clean a model's reply down to one command: no code fences, no prompt marker. */
export function cleanCommand(reply: string): string {
  const fenced = /```(?:\w+)?\n?([\s\S]*?)```/.exec(reply)
  const text = (fenced ? fenced[1]! : reply).trim()
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*\$\s+/, ""))
    .join("\n")
    .trim()
}

/** The last `count` lines of terminal output that carry text, for "Explain". */
export function lastLines(lines: string[], count = 40): string {
  const trimmed = lines.map((l) => l.trimEnd())
  while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop()
  return trimmed.slice(-count).join("\n")
}

/** A tab's label from the shell's window title ("user@host: ~/src" -> "~/src"). */
export function tabTitle(title: string): string {
  const t = title.trim()
  if (!t) return "Terminal"
  const colon = /^[\w.-]+@[\w.-]+:\s*(.+)$/.exec(t)
  return (colon ? colon[1]! : t).slice(0, 40)
}
