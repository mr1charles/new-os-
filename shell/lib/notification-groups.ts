/** Notification Center grouping, like macOS: one stack per app, newest app first. Pure. */

export interface Groupable {
  id: number
  appName: string | null
  desktopEntry: string | null
  time: number
}

export interface NotificationGroup<T extends Groupable> {
  key: string
  app: string
  items: T[]
}

const keyOf = (n: Groupable) => (n.desktopEntry || n.appName || "notification").toLowerCase()

export function groupNotifications<T extends Groupable>(
  items: readonly T[],
): NotificationGroup<T>[] {
  const groups = new Map<string, NotificationGroup<T>>()
  for (const n of [...items].sort((a, b) => b.time - a.time || b.id - a.id)) {
    const key = keyOf(n)
    let group = groups.get(key)
    if (!group) {
      group = { key, app: n.appName || "Notification", items: [] }
      groups.set(key, group)
    }
    group.items.push(n)
  }
  return [...groups.values()]
}
