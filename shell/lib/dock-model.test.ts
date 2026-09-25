import { describe, expect, it } from "vitest"
import {
  buildDockItems,
  magnifyLevel,
  matchApp,
  normalizeEntry,
  type DockApp,
  type DockClient,
} from "./dock-model"

const apps: DockApp[] = [
  {
    entry: "firefox.desktop",
    name: "Firefox",
    iconName: "firefox",
    wmClass: "firefox",
    executable: "/usr/lib/firefox/firefox %u",
  },
  {
    entry: "org.gnome.Nautilus.desktop",
    name: "Files",
    iconName: "org.gnome.Nautilus",
    wmClass: "",
    executable: "nautilus --new-window",
  },
  { entry: "kitty.desktop", name: "kitty", iconName: "kitty", wmClass: "", executable: "kitty" },
  {
    entry: "newos-settings.desktop",
    name: "Settings",
    iconName: "newos-settings",
    wmClass: "newos-settings",
    executable: "newos-settings",
  },
]

function client(cls: string, address: string, focus = 0): DockClient {
  return { address, class: cls, initialClass: cls, title: cls, focusHistoryId: focus }
}

describe("matchApp", () => {
  it("matches by WM class", () => {
    expect(matchApp(client("firefox", "0x1"), apps)?.entry).toBe("firefox.desktop")
  })

  it("matches reverse-DNS desktop ids by their last component", () => {
    expect(matchApp(client("org.gnome.Nautilus", "0x2"), apps)?.name).toBe("Files")
    expect(matchApp(client("nautilus", "0x2"), apps)?.name).toBe("Files")
  })

  it("matches by executable name", () => {
    expect(matchApp(client("kitty", "0x3"), apps)?.entry).toBe("kitty.desktop")
  })

  it("returns null for unknown windows", () => {
    expect(matchApp(client("mystery", "0x4"), apps)).toBeNull()
    expect(matchApp(client("", "0x5"), apps)).toBeNull()
  })
})

describe("buildDockItems", () => {
  it("keeps pinned order, skips missing apps, and appends running unpinned apps", () => {
    const items = buildDockItems(["newos-files", "firefox.desktop", "newos-settings"], apps, [
      client("kitty", "0xa", 1),
      client("firefox", "0xb", 0),
    ])
    expect(items.map((i) => i.key)).toEqual(["firefox", "newos-settings", "kitty"])
    expect(items[0]?.windows.map((w) => w.address)).toEqual(["0xb"])
    expect(items[2]?.pinned).toBe(false)
  })

  it("groups windows of the same app and sorts by focus recency", () => {
    const items = buildDockItems([], apps, [
      client("firefox", "0x1", 3),
      client("firefox", "0x2", 0),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.windows.map((w) => w.address)).toEqual(["0x2", "0x1"])
  })

  it("shows windows without a desktop entry under their class", () => {
    const items = buildDockItems([], apps, [client("Mystery", "0x9")])
    expect(items[0]?.key).toBe("class:mystery")
    expect(items[0]?.iconName).toBe("mystery")
  })

  it("normalizes desktop ids", () => {
    expect(normalizeEntry("org.gnome.Nautilus.desktop")).toBe("org.gnome.nautilus")
  })
})

describe("magnifyLevel", () => {
  it("peaks at the hovered icon and falls off with distance", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => magnifyLevel(i, 2))).toEqual([1, 2, 3, 2, 1, 0])
    expect(magnifyLevel(3, null)).toBe(0)
  })
})
