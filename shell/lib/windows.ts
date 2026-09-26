/**
 * Window snapping and arranging on Hyprland (geometry in lib/snap.ts).
 *
 *   snap left|right|up|down   step the focused window through zones, like Windows
 *   snap <zone>               put it in a zone (left, top-right, left-third, maximize...)
 *   arrange                   lay out every window on the desktop by how many there are
 */
import GLib from "gi://GLib?version=2.0"
import { hyprland } from "./services"
import { config, CONFIG_DIR } from "./config"
import { windowStyleConf } from "./window-style"
import {
  arrange,
  fitInside,
  isZone,
  nextZone,
  usableArea,
  zoneOf,
  zoneRect,
  type Rect,
  type Zone,
} from "./snap"

interface HyprMonitor {
  id: number
  x: number
  y: number
  width: number
  height: number
  scale: number
  transform: number
  reserved: number[]
  focused: boolean
  activeWorkspace: { id: number }
}

interface HyprClient {
  address: string
  at: [number, number]
  size: [number, number]
  floating: boolean
  fullscreen: number
  monitor: number
  mapped: boolean
  hidden: boolean
  workspace: { id: number }
  focusHistoryID: number
  pinned: boolean
  title: string
  initialTitle: string
}

/** Dialogs and pinned windows keep their place when windows are arranged. */
const DIALOG = /^(open|save|choose|select|print|export|import|confirm|preferences|properties)\b/i

function query<T>(what: string): T {
  if (!hyprland) throw new Error("not running on Hyprland")
  return JSON.parse(hyprland.message(`j/${what}`)) as T
}

function gap(): number {
  try {
    const option = query<{ custom?: string; int?: number }>("getoption general:gaps_out")
    const first = option.custom?.trim().split(/\s+/)[0]
    return Number(first ?? option.int ?? 12) || 0
  } catch {
    return 12
  }
}

function place(client: HyprClient, rect: Rect, area: Rect) {
  const target = `address:${client.address}`
  if (client.fullscreen) hyprland!.dispatch("fullscreen", "0")
  if (!client.floating) hyprland!.dispatch("setfloating", target)
  hyprland!.dispatch("resizewindowpixel", `exact ${rect.w} ${rect.h},${target}`)
  // Apps have minimum sizes; if it stayed bigger, keep it on screen instead of hanging off.
  const now = query<HyprClient[]>("clients").find((c) => c.address === client.address)
  const fitted = now ? fitInside(rect, { w: now.size[0], h: now.size[1] }, area) : rect
  hyprland!.dispatch("movewindowpixel", `exact ${fitted.x} ${fitted.y},${target}`)
  // The app answers the resize a moment later and may grow back to its minimum size around
  // its center; check again then.
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    const later = query<HyprClient[]>("clients").find((c) => c.address === client.address)
    if (later) {
      const again = fitInside(rect, { w: later.size[0], h: later.size[1] }, area)
      if (again.x !== later.at[0] || again.y !== later.at[1])
        hyprland!.dispatch("movewindowpixel", `exact ${again.x} ${again.y},${target}`)
    }
    return GLib.SOURCE_REMOVE
  })
}

function areaFor(client: HyprClient): Rect {
  const monitors = query<HyprMonitor[]>("monitors")
  const monitor = monitors.find((m) => m.id === client.monitor) ?? monitors.find((m) => m.focused)
  if (!monitor) throw new Error("no monitor")
  return usableArea(monitor)
}

export function snap(arg: string): string {
  const active = query<Partial<HyprClient>>("activewindow")
  if (!active.address) return "no window"
  const client = active as HyprClient
  const area = areaFor(client)
  const g = gap()
  let zone: Zone
  if (arg === "left" || arg === "right" || arg === "up" || arg === "down") {
    const current = zoneOf(
      { x: client.at[0], y: client.at[1], w: client.size[0], h: client.size[1] },
      area,
      g,
    )
    zone = nextZone(current, arg)
  } else if (isZone(arg)) {
    zone = arg
  } else {
    return "usage: snap left|right|up|down|<zone>"
  }
  place(client, zoneRect(zone, area, g), area)
  return zone
}

export function arrangeWorkspace(): string {
  const monitors = query<HyprMonitor[]>("monitors")
  const monitor = monitors.find((m) => m.focused)
  if (!monitor) return "no monitor"
  const windows = query<HyprClient[]>("clients")
    .filter(
      (c) =>
        c.mapped &&
        !c.hidden &&
        !c.pinned &&
        !c.fullscreen &&
        !DIALOG.test(c.initialTitle || c.title) &&
        c.workspace.id === monitor.activeWorkspace.id,
    )
    .sort((a, b) => a.focusHistoryID - b.focusHistoryID)
  const area = usableArea(monitor)
  const rects = arrange(windows.length, area, gap())
  windows.forEach((w, i) => place(w, rects[i]!, area))
  return `${windows.length} windows`
}

const STYLE_PATH = GLib.build_filenamev([CONFIG_DIR, "hyprland-windows.conf"])

function readText(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    return ok ? new TextDecoder().decode(bytes) : null
  } catch {
    return null
  }
}

/** Write the window settings for Hyprland and reload it when they changed. */
function applyWindowStyle() {
  const c = config.peek()
  const text = windowStyleConf(c)
  if (readText(STYLE_PATH) === text) return
  GLib.mkdir_with_parents(CONFIG_DIR, 0o755)
  GLib.file_set_contents(STYLE_PATH, text)
  if (!hyprland) return
  hyprland.message("reload")
  // Rules only apply to new windows; bring the open ones in line with the new layout.
  for (const client of query<HyprClient[]>("clients")) {
    const target = `address:${client.address}`
    if (
      c.windows.layout === "tiling" &&
      client.floating &&
      !client.pinned &&
      !DIALOG.test(client.initialTitle)
    )
      hyprland.dispatch("settiled", target)
    else if (c.windows.layout !== "tiling" && !client.floating)
      hyprland.dispatch("setfloating", target)
  }
  if (c.windows.layout === "arrange") arrangeWorkspace()
}

let pending: number | null = null
/** In "arrange" mode, re-arrange shortly after a window opens or closes. */
function scheduleArrange() {
  if (config.peek().windows.layout !== "arrange") return
  if (pending !== null) GLib.source_remove(pending)
  pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
    pending = null
    try {
      arrangeWorkspace()
    } catch (e) {
      console.warn(`helixos: arrange failed: ${e}`)
    }
    return GLib.SOURCE_REMOVE
  })
}

export function setupWindowManagement() {
  applyWindowStyle()
  config.subscribe(applyWindowStyle)
  if (!hyprland) return
  hyprland.connect("client-added", scheduleArrange)
  hyprland.connect("client-removed", scheduleArrange)
}
