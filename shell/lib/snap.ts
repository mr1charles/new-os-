/**
 * Window snapping and arranging, pure so it is tested in Node. The shell turns the rectangles
 * into Hyprland dispatches (lib/windows.ts).
 *
 * Zones are the familiar ones: halves, quarters, thirds, maximize, center. `arrange` lays out
 * every window on a desktop by how many there are: one fills the screen, two split it in
 * halves, three take a half and two quarters, four take quarters, more make a grid.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const ZONES = [
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "left-third",
  "center-third",
  "right-third",
  "left-two-thirds",
  "right-two-thirds",
  "maximize",
  "center",
] as const
export type Zone = (typeof ZONES)[number]

export function isZone(value: string): value is Zone {
  return (ZONES as readonly string[]).includes(value)
}

/** `area` is the monitor minus the bar and dock; `gap` separates windows and edges. */
export function zoneRect(zone: Zone, area: Rect, gap: number): Rect {
  const inner = { x: area.x + gap, y: area.y + gap, w: area.w - 2 * gap, h: area.h - 2 * gap }
  const halfW = Math.floor((inner.w - gap) / 2)
  const halfH = Math.floor((inner.h - gap) / 2)
  const thirdW = Math.floor((inner.w - 2 * gap) / 3)
  const right = (w: number) => inner.x + inner.w - w
  const bottom = (h: number) => inner.y + inner.h - h
  switch (zone) {
    case "left":
      return { ...inner, w: halfW }
    case "right":
      return { ...inner, x: right(halfW), w: halfW }
    case "top":
      return { ...inner, h: halfH }
    case "bottom":
      return { ...inner, y: bottom(halfH), h: halfH }
    case "top-left":
      return { x: inner.x, y: inner.y, w: halfW, h: halfH }
    case "top-right":
      return { x: right(halfW), y: inner.y, w: halfW, h: halfH }
    case "bottom-left":
      return { x: inner.x, y: bottom(halfH), w: halfW, h: halfH }
    case "bottom-right":
      return { x: right(halfW), y: bottom(halfH), w: halfW, h: halfH }
    case "left-third":
      return { ...inner, w: thirdW }
    case "center-third":
      return { ...inner, x: inner.x + thirdW + gap, w: thirdW }
    case "right-third":
      return { ...inner, x: right(thirdW), w: thirdW }
    case "left-two-thirds":
      return { ...inner, w: inner.w - thirdW - gap }
    case "right-two-thirds":
      return { ...inner, x: inner.x + thirdW + gap, w: inner.w - thirdW - gap }
    case "maximize":
      return inner
    case "center": {
      const w = Math.round(inner.w * 0.6)
      const h = Math.round(inner.h * 0.7)
      return {
        x: inner.x + Math.round((inner.w - w) / 2),
        y: inner.y + Math.round((inner.h - h) / 2),
        w,
        h,
      }
    }
  }
}

/** Where each of `count` windows goes, in order (the focused window first). */
export function arrange(count: number, area: Rect, gap: number): Rect[] {
  if (count <= 0) return []
  const layouts: Record<number, Zone[]> = {
    1: ["maximize"],
    2: ["left", "right"],
    3: ["left", "top-right", "bottom-right"],
    4: ["top-left", "top-right", "bottom-left", "bottom-right"],
  }
  const zones = layouts[count]
  if (zones) return zones.map((z) => zoneRect(z, area, gap))
  // A grid, filled row by row; the last row's windows share its width.
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const inner = { x: area.x + gap, y: area.y + gap, w: area.w - 2 * gap, h: area.h - 2 * gap }
  const cellH = Math.floor((inner.h - (rows - 1) * gap) / rows)
  const out: Rect[] = []
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, count - r * cols)
    const cellW = Math.floor((inner.w - (inRow - 1) * gap) / inRow)
    for (let c = 0; c < inRow; c++)
      out.push({
        x: inner.x + c * (cellW + gap),
        y: inner.y + r * (cellH + gap),
        w: cellW,
        h: cellH,
      })
  }
  return out
}

/**
 * Keyboard snapping that moves through zones like Windows: pressing Left on a window already
 * in the right half brings it back to the center, pressing Up on a left half makes it a
 * top-left quarter, and so on.
 */
export function nextZone(current: Zone | null, direction: "left" | "right" | "up" | "down"): Zone {
  const table: Partial<Record<Zone | "none", Partial<Record<typeof direction, Zone>>>> = {
    none: { left: "left", right: "right", up: "maximize", down: "center" },
    center: { left: "left", right: "right", up: "maximize", down: "center" },
    maximize: { left: "left", right: "right", up: "maximize", down: "center" },
    left: { left: "left-third", right: "center", up: "top-left", down: "bottom-left" },
    right: { left: "center", right: "right-third", up: "top-right", down: "bottom-right" },
    "left-third": { left: "left-third", right: "left", up: "top-left", down: "bottom-left" },
    "right-third": { left: "right", right: "right-third", up: "top-right", down: "bottom-right" },
    "top-left": { left: "top-left", right: "top-right", up: "top", down: "left" },
    "top-right": { left: "top-left", right: "top-right", up: "top", down: "right" },
    "bottom-left": { left: "bottom-left", right: "bottom-right", up: "left", down: "bottom" },
    "bottom-right": { left: "bottom-left", right: "bottom-right", up: "right", down: "bottom" },
    top: { left: "top-left", right: "top-right", up: "maximize", down: "center" },
    bottom: { left: "bottom-left", right: "bottom-right", up: "center", down: "bottom" },
  }
  return table[current ?? "none"]?.[direction] ?? table.none![direction]!
}

/** Which zone a window's rectangle is in (within a few pixels), if any. */
export function zoneOf(rect: Rect, area: Rect, gap: number, tolerance = 8): Zone | null {
  for (const zone of ZONES) {
    const z = zoneRect(zone, area, gap)
    if (
      Math.abs(z.x - rect.x) <= tolerance &&
      Math.abs(z.y - rect.y) <= tolerance &&
      Math.abs(z.w - rect.w) <= tolerance &&
      Math.abs(z.h - rect.h) <= tolerance
    )
      return zone
  }
  return null
}

/** The part of a monitor (hyprctl -j monitors) that windows may use, in layout pixels. */
export function usableArea(monitor: {
  x: number
  y: number
  width: number
  height: number
  scale: number
  transform?: number
  reserved: number[]
}): Rect {
  const rotated = (monitor.transform ?? 0) % 2 === 1
  const w = Math.round((rotated ? monitor.height : monitor.width) / monitor.scale)
  const h = Math.round((rotated ? monitor.width : monitor.height) / monitor.scale)
  const [left = 0, top = 0, right = 0, bottom = 0] = monitor.reserved
  return { x: monitor.x + left, y: monitor.y + top, w: w - left - right, h: h - top - bottom }
}

/**
 * Where to put a window of `size` that was meant for `rect` but could not shrink that far (apps
 * have minimum sizes): as close to `rect` as possible while staying inside `area`.
 */
export function fitInside(rect: Rect, size: { w: number; h: number }, area: Rect): Rect {
  const w = Math.max(rect.w, size.w)
  const h = Math.max(rect.h, size.h)
  const x = Math.max(area.x, Math.min(rect.x, area.x + area.w - w))
  const y = Math.max(area.y, Math.min(rect.y, area.y + area.h - h))
  return { x, y, w, h }
}
