import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, mergeConfig, parseConfig, resolveTheme } from "./config-schema"
import {
  formatClock,
  formatCountdown,
  formatPercent,
  formatRemaining,
  formatTime,
  parseDuration,
  timeAgo,
} from "./format"

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

describe("format", () => {
  const date = new Date(2026, 8, 24, 23, 5, 9)

  it("formats the menu bar clock", () => {
    expect(formatClock(date, false)).toBe("Thu Sep 24  11:05 PM")
    expect(formatClock(date, true, true)).toBe("Thu Sep 24  23:05:09")
    expect(formatTime(new Date(2026, 0, 1, 0, 7), false)).toBe("12:07 AM")
    expect(formatTime(new Date(2026, 0, 1, 12, 0), false)).toBe("12:00 PM")
  })

  it("formats countdowns and remaining time", () => {
    expect(formatCountdown(245_000)).toBe("4:05")
    expect(formatCountdown(3_723_000)).toBe("1:02:03")
    expect(formatCountdown(-5)).toBe("0:00")
    expect(formatRemaining(8100)).toBe("2 hr 15 min")
    expect(formatRemaining(2700)).toBe("45 min")
    expect(formatRemaining(7200)).toBe("2 hr")
    expect(formatRemaining(0)).toBe("")
  })

  it("formats relative times and percents", () => {
    const now = date.getTime()
    expect(timeAgo(now - 5_000, now)).toBe("now")
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago")
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago")
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe("Yesterday")
    expect(formatPercent(0.456)).toBe("46%")
    expect(formatPercent(1.2)).toBe("100%")
  })

  it("parses spoken durations", () => {
    expect(parseDuration("10m")).toBe(600_000)
    expect(parseDuration("1h30m")).toBe(5_400_000)
    expect(parseDuration("set a timer for 90 seconds")).toBe(90_000)
    expect(parseDuration("5 minutes")).toBe(300_000)
    expect(parseDuration("soon")).toBeNull()
  })
})
