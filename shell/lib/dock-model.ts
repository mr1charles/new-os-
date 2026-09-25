/**
 * Dock contents: pinned apps first (in the user's order), then running apps that are not
 * pinned. Windows are matched to desktop entries by WM class, desktop id, executable name,
 * or app name, in that order. Pure TypeScript so it can be tested in Node.
 */

export interface DockApp {
  /** Desktop file id, for example "firefox.desktop". */
  entry: string
  name: string
  iconName: string
  wmClass: string
  executable: string
}

export interface DockClient {
  address: string
  class: string
  initialClass: string
  title: string
  focusHistoryId: number
}

export interface DockItem {
  key: string
  app: DockApp | null
  name: string
  iconName: string
  pinned: boolean
  windows: DockClient[]
}

/** "org.gnome.Nautilus.desktop" -> "org.gnome.nautilus" */
export function normalizeEntry(entry: string): string {
  return entry.replace(/\.desktop$/i, "").toLowerCase()
}

function executableName(exec: string): string {
  const first = exec.trim().split(/\s+/)[0] ?? ""
  const base = first.split("/").pop() ?? ""
  return base.toLowerCase()
}

/** Find the desktop entry for a window. Returns null for windows with no matching entry. */
export function matchApp(client: DockClient, apps: DockApp[]): DockApp | null {
  const classes = [client.class, client.initialClass]
    .filter((c) => c.length > 0)
    .map((c) => c.toLowerCase())
  if (classes.length === 0) return null

  const byWmClass = apps.find((a) => a.wmClass && classes.includes(a.wmClass.toLowerCase()))
  if (byWmClass) return byWmClass

  const byEntry = apps.find((a) => {
    const id = normalizeEntry(a.entry)
    const last = id.split(".").pop() ?? id
    return classes.includes(id) || classes.includes(last)
  })
  if (byEntry) return byEntry

  const byExec = apps.find((a) => a.executable && classes.includes(executableName(a.executable)))
  if (byExec) return byExec

  return apps.find((a) => classes.includes(a.name.toLowerCase())) ?? null
}

export function findApp(entry: string, apps: DockApp[]): DockApp | null {
  const wanted = normalizeEntry(entry)
  return apps.find((a) => normalizeEntry(a.entry) === wanted) ?? null
}

export function buildDockItems(
  pinned: string[],
  apps: DockApp[],
  clients: DockClient[],
): DockItem[] {
  const items: DockItem[] = []
  const byKey = new Map<string, DockItem>()

  for (const entry of pinned) {
    const key = normalizeEntry(entry)
    if (byKey.has(key)) continue
    const app = findApp(entry, apps)
    if (!app) continue
    const item: DockItem = {
      key,
      app,
      name: app.name,
      iconName: app.iconName || "application-x-executable",
      pinned: true,
      windows: [],
    }
    byKey.set(key, item)
    items.push(item)
  }

  for (const client of clients) {
    const app = matchApp(client, apps)
    const key = app ? normalizeEntry(app.entry) : `class:${client.class.toLowerCase()}`
    let item = byKey.get(key)
    if (!item) {
      item = {
        key,
        app,
        name: app?.name ?? client.class,
        iconName: app?.iconName || client.class.toLowerCase() || "application-x-executable",
        pinned: false,
        windows: [],
      }
      byKey.set(key, item)
      items.push(item)
    }
    item.windows.push(client)
  }

  // Most recently focused window first, so clicking an icon focuses what the user saw last.
  for (const item of items) item.windows.sort((a, b) => a.focusHistoryId - b.focusHistoryId)
  return items
}

/**
 * Magnification level for a dock icon given which icon the pointer is over.
 * The hovered icon gets `radius + 1`, its neighbours less, icons further away 0.
 */
export function magnifyLevel(index: number, hovered: number | null, radius = 2): number {
  if (hovered === null) return 0
  const distance = Math.abs(index - hovered)
  return distance > radius ? 0 : radius + 1 - distance
}
