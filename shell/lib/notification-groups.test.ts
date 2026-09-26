import { describe, expect, it } from "vitest"
import { groupNotifications } from "./notification-groups"

const n = (id: number, appName: string, time: number, desktopEntry = "") => ({
  id,
  appName,
  desktopEntry,
  time,
})

describe("groupNotifications", () => {
  it("stacks by app, newest app and newest item first", () => {
    const groups = groupNotifications([
      n(1, "Files", 10),
      n(2, "Terminal", 30),
      n(3, "Files", 40),
      n(4, "Terminal", 20),
      n(5, "files", 5, ""),
    ])
    expect(groups.map((g) => [g.app, g.items.map((i) => i.id)])).toEqual([
      ["Files", [3, 1, 5]],
      ["Terminal", [2, 4]],
    ])
  })

  it("prefers the desktop entry, so renamed senders stay together", () => {
    const groups = groupNotifications([
      n(1, "Firefox", 2, "firefox"),
      n(2, "Mozilla Firefox", 1, "firefox"),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.app).toBe("Firefox")
  })
})
