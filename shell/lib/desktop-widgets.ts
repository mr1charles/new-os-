/**
 * Desktop widgets (widgets/DesktopWidgets.tsx): what each kind shows, computed here so it is
 * tested in Node. Weather comes from Open-Meteo (no account or key needed).
 */

export const WIDGET_KINDS = ["weather", "batteries", "clock", "calendar"] as const
export type WidgetKind = (typeof WIDGET_KINDS)[number]

export const WIDGET_INFO: Record<WidgetKind, { name: string; description: string; icon: string }> =
  {
    weather: {
      name: "Weather",
      description: "Now and the next hours",
      icon: "weather-few-clouds-symbolic",
    },
    batteries: {
      name: "Batteries",
      description: "This computer and your headphones",
      icon: "battery-good-symbolic",
    },
    clock: {
      name: "Clock",
      description: "An analog clock",
      icon: "preferences-system-time-symbolic",
    },
    calendar: { name: "Calendar", description: "This month", icon: "x-office-calendar-symbolic" },
  }

export function isWidgetKind(value: string): value is WidgetKind {
  return (WIDGET_KINDS as readonly string[]).includes(value)
}

/** The widgets to show: known kinds, each once, in the saved order. */
export function shownWidgets(saved: readonly string[]): WidgetKind[] {
  return [...new Set(saved)].filter(isWidgetKind)
}

// ---------------------------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------------------------

/** WMO weather codes (Open-Meteo) → words and a symbolic icon; night gets the night icons. */
export function describeWeather(code: number, isDay: boolean): { text: string; icon: string } {
  const night = isDay ? "" : "-night"
  if (code === 0) return { text: isDay ? "Sunny" : "Clear", icon: `weather-clear${night}-symbolic` }
  if (code === 1) return { text: "Mostly Clear", icon: `weather-few-clouds${night}-symbolic` }
  if (code === 2) return { text: "Partly Cloudy", icon: `weather-few-clouds${night}-symbolic` }
  if (code === 3) return { text: "Cloudy", icon: "weather-overcast-symbolic" }
  if (code === 45 || code === 48) return { text: "Fog", icon: "weather-fog-symbolic" }
  if (code >= 51 && code <= 57)
    return { text: "Drizzle", icon: "weather-showers-scattered-symbolic" }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return {
      text: code === 65 || code === 82 ? "Heavy Rain" : "Rain",
      icon: "weather-showers-symbolic",
    }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { text: "Snow", icon: "weather-snow-symbolic" }
  if (code >= 95) return { text: "Thunderstorms", icon: "weather-storm-symbolic" }
  return { text: "—", icon: "weather-overcast-symbolic" }
}

export interface Weather {
  place: string
  temperature: number
  code: number
  isDay: boolean
  high: number
  low: number
  hours: { label: string; temperature: number; code: number; isDay: boolean }[]
}

export function forecastUrl(latitude: number, longitude: number, fahrenheit: boolean): string {
  const params = [
    `latitude=${latitude.toFixed(3)}`,
    `longitude=${longitude.toFixed(3)}`,
    "current=temperature_2m,weather_code,is_day",
    "hourly=temperature_2m,weather_code,is_day",
    "daily=temperature_2m_max,temperature_2m_min",
    "timezone=auto",
    "forecast_days=2",
    ...(fahrenheit ? ["temperature_unit=fahrenheit"] : []),
  ]
  return `https://api.open-meteo.com/v1/forecast?${params.join("&")}`
}

export function geocodeUrl(city: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(city.trim())}`
}

/** "1 pm", or "13:00" with a 24-hour clock. */
export function hourLabel(hour: number, clock24h: boolean): string {
  if (clock24h) return `${String(hour).padStart(2, "0")}:00`
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h} ${hour < 12 ? "am" : "pm"}`
}

interface ForecastJson {
  current?: { time?: string; temperature_2m?: number; weather_code?: number; is_day?: number }
  hourly?: {
    time?: string[]
    temperature_2m?: number[]
    weather_code?: number[]
    is_day?: number[]
  }
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] }
}

/** The widget's data from an Open-Meteo forecast: now, today's range, and the next six hours. */
export function parseForecast(
  place: string,
  json: unknown,
  clock24h: boolean,
  count = 6,
): Weather | null {
  const data = json as ForecastJson
  const current = data?.current
  const hourly = data?.hourly
  if (!current || typeof current.temperature_2m !== "number" || !hourly?.time) return null
  // Hourly times are local ("2026-09-26T14:00"); start after the current hour.
  const nowHour = (current.time ?? "").slice(0, 13)
  let start = hourly.time.findIndex((t) => t.slice(0, 13) > nowHour)
  if (start < 0) start = 0
  const hours = hourly.time.slice(start, start + count).map((t, i) => ({
    label: hourLabel(Number(t.slice(11, 13)), clock24h),
    temperature: Math.round(hourly.temperature_2m?.[start + i] ?? 0),
    code: hourly.weather_code?.[start + i] ?? 0,
    isDay: (hourly.is_day?.[start + i] ?? 1) === 1,
  }))
  return {
    place,
    temperature: Math.round(current.temperature_2m),
    code: current.weather_code ?? 0,
    isDay: (current.is_day ?? 1) === 1,
    high: Math.round(data.daily?.temperature_2m_max?.[0] ?? current.temperature_2m),
    low: Math.round(data.daily?.temperature_2m_min?.[0] ?? current.temperature_2m),
    hours,
  }
}

// ---------------------------------------------------------------------------------------------
// Calendar and clock
// ---------------------------------------------------------------------------------------------

/**
 * The month as weeks of day numbers (null for blanks), weeks starting on Monday like the
 * reference design, or Sunday.
 */
export function monthGrid(year: number, month: number, mondayFirst = true): (number | null)[][] {
  const first = new Date(year, month, 1).getDay() // 0 = Sunday
  const offset = mondayFirst ? (first + 6) % 7 : first
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array<null>(offset).fill(null)]
  for (let d = 1; d <= days; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Hand angles in degrees clockwise from 12. */
export function clockAngles(date: Date): { hour: number; minute: number; second: number } {
  const s = date.getSeconds() + date.getMilliseconds() / 1000
  const m = date.getMinutes() + s / 60
  const h = (date.getHours() % 12) + m / 60
  return { hour: h * 30, minute: m * 6, second: s * 6 }
}

// ---------------------------------------------------------------------------------------------
// Batteries
// ---------------------------------------------------------------------------------------------

export interface BatteryRing {
  icon: string
  label: string
  /** 0..1, or null for an empty slot. */
  level: number | null
  charging: boolean
}

/** Four rings: this computer first, then Bluetooth devices that report a level, then empty. */
export function batteryRings(
  computer: { level: number; charging: boolean } | null,
  devices: { name: string; icon: string; level: number }[],
  slots = 4,
): BatteryRing[] {
  const rings: BatteryRing[] = []
  if (computer)
    rings.push({
      icon: "computer-symbolic",
      label: "This Computer",
      level: computer.level,
      charging: computer.charging,
    })
  for (const d of devices) {
    if (d.level < 0) continue
    rings.push({
      icon: `${d.icon || "bluetooth"}-symbolic`.replace(/-symbolic-symbolic$/, "-symbolic"),
      label: d.name,
      level: d.level,
      charging: false,
    })
  }
  while (rings.length < slots) rings.push({ icon: "", label: "", level: null, charging: false })
  return rings.slice(0, slots)
}

export const WIDGET_SIZE: Record<WidgetKind, "small" | "medium"> = {
  weather: "medium",
  batteries: "medium",
  clock: "small",
  calendar: "small",
}

/** Rows for the desktop column: a medium widget takes a row, small ones pair up. */
export function widgetRows(kinds: readonly WidgetKind[]): WidgetKind[][] {
  const rows: WidgetKind[][] = []
  for (const kind of kinds) {
    const last = rows.at(-1)
    if (WIDGET_SIZE[kind] === "small" && last?.length === 1 && WIDGET_SIZE[last[0]!] === "small")
      last.push(kind)
    else rows.push([kind])
  }
  return rows
}

// ---------------------------------------------------------------------------------------------
// Placement: widgets can be dragged anywhere; positions are saved as "kind:x:y".
// ---------------------------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Card sizes in layout pixels, including the card's padding and border. */
export const CARD_SIZE: Record<"small" | "medium", { w: number; h: number }> = {
  medium: { w: 352, h: 172 },
  small: { w: 184, h: 172 },
}

const GRID = 8
export const snap = (v: number) => Math.round(v / GRID) * GRID

export function parsePositions(
  saved: readonly string[],
): Map<WidgetKind, { x: number; y: number }> {
  const out = new Map<WidgetKind, { x: number; y: number }>()
  for (const entry of saved) {
    const [kind, x, y] = entry.split(":")
    if (!kind || !isWidgetKind(kind)) continue
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny)) out.set(kind, { x: nx, y: ny })
  }
  return out
}

export function serializePositions(positions: Map<WidgetKind, { x: number; y: number }>): string[] {
  return [...positions].map(([kind, p]) => `${kind}:${Math.round(p.x)}:${Math.round(p.y)}`)
}

const overlaps = (a: Rect, b: Rect, gap = 12) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/** Keep a card fully inside the area. */
export function clampInto(p: { x: number; y: number }, size: { w: number; h: number }, area: Rect) {
  return {
    x: snap(Math.min(Math.max(p.x, area.x), area.x + area.w - size.w)),
    y: snap(Math.min(Math.max(p.y, area.y), area.y + area.h - size.h)),
  }
}

/**
 * The first free spot for a card, going down columns from the chosen side. When the reserved
 * area (between the bar and the Dock) has no room left, the search continues below it: a
 * widget partly behind the Dock is still visible and draggable, unlike one placed exactly on
 * top of another (which was silently unreachable — see the placement tests).
 */
export function freeSpot(
  taken: readonly Rect[],
  size: { w: number; h: number },
  area: Rect,
  side: "left" | "right",
): { x: number; y: number } {
  const step = GRID * 2
  const columns: number[] = []
  for (let x = area.x; x + size.w <= area.x + area.w; x += step) columns.push(x)
  if (side === "right") columns.reverse()
  const overflow = Math.max(area.h * 4, 2000)
  for (const x of columns)
    for (let y = area.y; y + size.h <= area.y + area.h + overflow; y += step) {
      const rect = { x: snap(x), y: snap(y), w: size.w, h: size.h }
      if (!taken.some((t) => overlaps(t, rect))) return { x: rect.x, y: rect.y }
    }
  // No column is even wide enough for the card (the desktop itself is narrower than one
  // widget): stagger so each one stays at least partly visible and clickable, rather than
  // exactly hidden under the last.
  const stagger = taken.length * 28
  return {
    x: snap(area.x + (stagger % Math.max(1, area.w - size.w + 1))),
    y: snap(area.y + (stagger % 200)),
  }
}

/**
 * Where every shown widget goes: its saved spot (kept on screen), or the first free spot for
 * widgets without one, in order.
 */
export function placeWidgets(
  kinds: readonly WidgetKind[],
  saved: readonly string[],
  area: Rect,
  side: "left" | "right",
): Map<WidgetKind, Rect> {
  const positions = parsePositions(saved)
  const placed = new Map<WidgetKind, Rect>()
  for (const kind of kinds) {
    const size = CARD_SIZE[WIDGET_SIZE[kind]]
    const p = positions.get(kind)
    if (p) placed.set(kind, { ...clampInto(p, size, area), ...size })
  }
  for (const kind of kinds) {
    if (placed.has(kind)) continue
    const size = CARD_SIZE[WIDGET_SIZE[kind]]
    placed.set(kind, { ...freeSpot([...placed.values()], size, area, side), ...size })
  }
  return placed
}
