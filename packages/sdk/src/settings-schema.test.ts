import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, mergeConfig, parseConfig, resolveTheme } from "./settings-schema"

describe("config", () => {
  it("uses defaults for missing or broken files", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(parseConfig("{ not json")).toEqual(DEFAULT_CONFIG)
  })

  it("merges valid values and ignores wrong types", () => {
    const config = parseConfig(
      JSON.stringify({
        appearance: { theme: "light", accent: 42, unknown: true },
        dock: { pinned: ["a", "b"], magnification: "yes" },
        bar: { clock24h: true },
      }),
    )
    expect(config.appearance.theme).toBe("light")
    expect(config.appearance.accent).toBe(DEFAULT_CONFIG.appearance.accent)
    expect(config.dock.pinned).toEqual(["a", "b"])
    expect(config.dock.magnification).toBe(true)
    expect(config.bar.clock24h).toBe(true)
    expect("unknown" in config.appearance).toBe(false)
  })

  it("rejects invalid theme names and non-string pinned entries", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      appearance: { theme: "purple" },
      dock: { pinned: [1, 2] },
    })
    expect(config.appearance.theme).toBe(DEFAULT_CONFIG.appearance.theme)
    expect(config.dock.pinned).toEqual(DEFAULT_CONFIG.dock.pinned)
  })

  it("does not mutate the defaults", () => {
    const config = parseConfig(JSON.stringify({ dock: { pinned: ["x"] } }))
    config.appearance.accent = "pink"
    expect(DEFAULT_CONFIG.appearance.accent).toBe("blue")
  })

  it("resolves auto theme by time of day", () => {
    expect(resolveTheme("auto", new Date(2026, 0, 1, 12))).toBe("light")
    expect(resolveTheme("auto", new Date(2026, 0, 1, 22))).toBe("dark")
    expect(resolveTheme("dark", new Date(2026, 0, 1, 12))).toBe("dark")
  })
})

describe("choices and ranges", () => {
  it("keeps only allowed choices and clamps numbers", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      dock: { position: "top", style: "taskbar", iconSize: 400 },
      windows: { layout: "tiling", rounding: -3.6, gaps: Number.NaN, controls: "windows" },
    })
    expect(config.dock.position).toBe("bottom")
    expect(config.dock.style).toBe("taskbar")
    expect(config.dock.iconSize).toBe(72)
    expect(config.windows).toMatchObject({
      layout: "tiling",
      rounding: 0,
      gaps: 12,
      controls: "windows",
    })
  })
})

describe("list choices", () => {
  it("keeps only known widgets, once each", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      widgets: { items: ["clock", "bogus", "clock", "weather"] },
    })
    expect(config.widgets.items).toEqual(["clock", "weather"])
  })
})

describe("migration", () => {
  it("renames apps pinned before HelixOS was renamed", () => {
    const config = parseConfig(JSON.stringify({ dock: { pinned: ["newos-files", "firefox"] } }))
    expect(config.dock.pinned).toEqual(["helixos-files", "firefox"])
  })
})
