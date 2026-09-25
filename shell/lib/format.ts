/** Formatting helpers shared by the bar, island, and panels. */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function pad(n: number): string {
  return n.toString().padStart(2, "0")
}

export function formatTime(date: Date, clock24h: boolean, showSeconds = false): string {
  const h = date.getHours()
  const m = pad(date.getMinutes())
  const s = showSeconds ? `:${pad(date.getSeconds())}` : ""
  if (clock24h) return `${pad(h)}:${m}${s}`
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${m}${s} ${h < 12 ? "AM" : "PM"}`
}

/** Menu bar clock, macOS style: "Thu Sep 24  11:32 PM". */
export function formatClock(date: Date, clock24h: boolean, showSeconds = false): string {
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}  ${formatTime(date, clock24h, showSeconds)}`
}

export function formatLongDate(date: Date): string {
  const long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  return `${long[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** Countdown: "4:05", "1:02:03". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Battery estimate: "2 hr 15 min", "45 min". Empty when unknown. */
export function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** Notification timestamps: "now", "5m ago", "3h ago", "Yesterday", "Sep 12". */
export function timeAgo(epochMs: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - epochMs) / 1000)
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return "Yesterday"
  const date = new Date(epochMs)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
}

/** Parse "10m", "90s", "1h30m", "5 minutes" into milliseconds. */
export function parseDuration(text: string): number | null {
  const pattern =
    /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)(?![a-z])/gi
  let total = 0
  let matched = false
  for (const match of text.matchAll(pattern)) {
    matched = true
    const value = Number(match[1])
    const unit = match[2]!.toLowerCase()
    if (unit.startsWith("h")) total += value * 3_600_000
    else if (unit.startsWith("m")) total += value * 60_000
    else total += value * 1000
  }
  return matched && total > 0 ? Math.round(total) : null
}
