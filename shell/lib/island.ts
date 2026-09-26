/**
 * Reactive wrapper around IslandQueue: exposes the current activity, the island size and
 * stack page as gnim accessors, and schedules a single timer for the next expiry.
 */
import GLib from "gi://GLib?version=2.0"
import { hyprland } from "./services"
import { config } from "./config"
import { createBinding, createComputed, createState, type Accessor } from "ags"
import {
  contextualSize,
  IslandQueue,
  islandPageName,
  restingWidth,
  visibleOverFullscreen,
  type Activity,
  type IslandKind,
  type IslandPayloads,
} from "./island-queue"

export const island = new IslandQueue()

const [current, setCurrent] = createState<Activity | null>(null)
const [hovered, setHoveredState] = createState(false)
export { current, hovered }

let timer: number | null = null
let refreshing = false

function schedule() {
  if (timer !== null) {
    GLib.source_remove(timer)
    timer = null
  }
  const next = island.nextExpiry()
  if (next === null) return
  timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(16, next - Date.now()), () => {
    timer = null
    refresh()
    return GLib.SOURCE_REMOVE
  })
}

function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    island.prune()
    setCurrent(island.current())
    schedule()
  } finally {
    refreshing = false
  }
}

island.subscribe(refresh)

/** The focused window's app class, and whether its workspace is fullscreen. */
const focusedApp: Accessor<string> = hyprland
  ? createBinding(hyprland, "focusedClient").as((c) => c?.class ?? "")
  : createState("")[0]
const [fullscreen, setFullscreen] = createState(false)
if (hyprland) {
  const h = hyprland
  const check = () => setFullscreen(h.focusedWorkspace?.hasFullscreen ?? false)
  // Fullscreen toggles, workspace switches, and focus changes can all change it.
  h.connect("event", (_self, event) => {
    if (
      event === "fullscreen" ||
      event === "workspace" ||
      event === "workspacev2" ||
      event === "activewindowv2"
    )
      check()
  })
  check()
}

export const size = createComputed(() => contextualSize(current(), hovered(), focusedApp()))
/**
 * Hidden over fullscreen apps unless something needs attention. Without the menu bar at the
 * top (taskbar, or the bar at the bottom) it only drops in while something is happening.
 */
export const islandVisible = createComputed(() => {
  const c = config()
  const docked = c.dock.style !== "taskbar" && c.bar.position === "top"
  if (!docked && current() === null) return false
  return !fullscreen() || visibleOverFullscreen(current())
})
/** Width the menu bar keeps free in its middle for the resting island. */
export const islandFootprint = current.as((a) => restingWidth(a) + 24)
export const page = createComputed(() => islandPageName(current(), size()))

/** While hovered, transient activities stay; they leave shortly after the pointer does. */
export function setHovered(value: boolean) {
  setHoveredState(value)
  const activity = current.peek()
  if (activity && activity.expiresAt !== null) {
    island.retime(activity.id, value ? 60_000 : 1500)
  }
}

/**
 * Accessor for the latest payload of a kind. Keeps the last value after the activity leaves
 * so labels do not blank out during the crossfade.
 */
export function payloadOf<K extends IslandKind>(kind: K, fallback: IslandPayloads[K]) {
  let last = fallback
  return current.as((activity) => {
    if (activity && activity.kind === kind) last = activity.payload as IslandPayloads[K]
    return last
  })
}
