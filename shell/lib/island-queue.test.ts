import { describe, expect, it } from "vitest"
import {
  IslandQueue,
  islandPageName,
  resolveIslandSize,
  type LevelPayload,
  type MediaPayload,
  contextualSize,
  restingWidth,
  sameApp,
  visibleOverFullscreen,
} from "./island-queue"

const media: MediaPayload = {
  title: "Song",
  artist: "Artist",
  coverArt: "",
  playing: true,
  busName: "x",
}
const volume: LevelPayload = { value: 0.5, muted: false, icon: "audio-volume-medium-symbolic" }

describe("IslandQueue", () => {
  it("shows nothing when empty", () => {
    const q = new IslandQueue()
    expect(q.current(0)).toBeNull()
    expect(q.nextExpiry()).toBeNull()
  })

  it("prefers higher priority activities", () => {
    const q = new IslandQueue()
    q.upsert("media", media, {}, 0)
    q.upsert("volume", volume, {}, 0)
    expect(q.current(0)?.kind).toBe("volume")
  })

  it("falls back to live activities when transient ones expire", () => {
    const q = new IslandQueue()
    q.upsert("media", media, {}, 0)
    q.upsert("volume", volume, { ttlMs: 1000 }, 0)
    expect(q.current(999)?.kind).toBe("volume")
    expect(q.current(1000)?.kind).toBe("media")
    expect(q.prune(1000)).toBe(true)
    expect(q.size).toBe(1)
  })

  it("replaces an activity with the same id instead of stacking", () => {
    const q = new IslandQueue()
    q.upsert("volume", volume, {}, 0)
    q.upsert("volume", { ...volume, value: 0.8 }, {}, 10)
    expect(q.size).toBe(1)
    const current = q.current(10)
    expect(current?.kind === "volume" && current.payload.value).toBe(0.8)
  })

  it("breaks priority ties by recency", () => {
    const q = new IslandQueue()
    const base = {
      appName: "Mail",
      appIcon: "",
      image: "",
      body: "",
      urgency: "normal" as const,
      actions: [],
    }
    q.upsert("notification", { ...base, notificationId: 1, summary: "first" }, { id: "n1" }, 0)
    q.upsert("notification", { ...base, notificationId: 2, summary: "second" }, { id: "n2" }, 0)
    const current = q.current(0)
    expect(current?.kind === "notification" && current.payload.summary).toBe("second")
    q.dismiss("n2")
    const next = q.current(0)
    expect(next?.kind === "notification" && next.payload.summary).toBe("first")
  })

  it("reports the next expiry and can extend it", () => {
    const q = new IslandQueue()
    q.upsert("volume", volume, { ttlMs: 1500 }, 100)
    expect(q.nextExpiry()).toBe(1600)
    q.extend("volume", 3000, 1000)
    expect(q.nextExpiry()).toBe(4000)
  })

  it("retimes transient activities but never live ones", () => {
    const q = new IslandQueue()
    q.upsert("volume", volume, { ttlMs: 1500 }, 0)
    q.upsert("media", media, {}, 0)
    expect(q.retime("volume", 60_000, 1000)).toBe(true)
    expect(q.nextExpiry()).toBe(61_000)
    expect(q.retime("volume", 200, 2000)).toBe(true)
    expect(q.nextExpiry()).toBe(2200)
    expect(q.retime("media", 10, 0)).toBe(false)
  })

  it("patches payloads in place and notifies listeners", () => {
    const q = new IslandQueue()
    let calls = 0
    q.subscribe(() => calls++)
    q.upsert("media", media, {}, 0)
    expect(q.patch("media", "media", { playing: false })).toBe(true)
    expect(q.patch("media", "volume", { value: 1 })).toBe(false)
    const current = q.current(0)
    expect(current?.kind === "media" && current.payload.playing).toBe(false)
    expect(calls).toBe(2)
  })

  it("dismisses every activity of a kind", () => {
    const q = new IslandQueue()
    q.upsert(
      "timer",
      { timerId: "a", label: "", endsAt: 1, durationMs: 1, finished: false },
      { id: "a" },
    )
    q.upsert(
      "timer",
      { timerId: "b", label: "", endsAt: 1, durationMs: 1, finished: false },
      { id: "b" },
    )
    expect(q.dismissKind("timer")).toBe(2)
    expect(q.size).toBe(0)
  })
})

describe("island sizing", () => {
  it("grows compact live activities on hover", () => {
    const q = new IslandQueue()
    const activity = q.upsert("media", media, {}, 0)
    expect(resolveIslandSize(activity, false)).toBe("compact")
    expect(resolveIslandSize(activity, true)).toBe("expanded")
    expect(islandPageName(activity, "compact")).toBe("media-compact")
    expect(islandPageName(activity, "expanded")).toBe("media")
  })

  it("uses idle pages when nothing is happening", () => {
    expect(resolveIslandSize(null, false)).toBe("compact")
    expect(islandPageName(null, "compact")).toBe("idle-compact")
    expect(islandPageName(null, resolveIslandSize(null, true))).toBe("idle")
  })

  it("keeps large activities large", () => {
    const q = new IslandQueue()
    const activity = q.upsert("confirm", { requestId: "1", tool: "run_shell", summary: "ls" })
    expect(resolveIslandSize(activity, false)).toBe("large")
    expect(islandPageName(activity, "large")).toBe("confirm")
  })
})

describe("island in context", () => {
  const q = new IslandQueue()
  const activity = q.upsert("activity", {
    app: "helixos-files",
    icon: "",
    title: "Copying 3 items",
    subtitle: "",
    progress: 0.4,
  })

  it("keeps an app's activity compact while that app is in front", () => {
    expect(contextualSize(activity, false, "helixos-files")).toBe("compact")
    expect(contextualSize(activity, false, "org.helixos.Files".replace("Files", "files"))).toBe(
      "compact",
    )
    expect(contextualSize(activity, true, "helixos-files")).toBe("expanded")
    expect(contextualSize(activity, false, "firefox")).toBe("compact")
  })

  it("matches apps across class and desktop id spellings", () => {
    expect(sameApp("helixos-files.desktop", "HelixOS-Files")).toBe(true)
    expect(sameApp("", "")).toBe(false)
  })

  it("hides over fullscreen apps unless it needs attention", () => {
    expect(visibleOverFullscreen(activity)).toBe(false)
    const confirm = q.upsert("confirm", { requestId: "1", tool: "run_shell", summary: "rm x" })
    expect(visibleOverFullscreen(confirm)).toBe(true)
    expect(visibleOverFullscreen(null)).toBe(false)
  })

  it("reserves room in the menu bar", () => {
    expect(restingWidth(null)).toBe(190)
    expect(restingWidth(activity)).toBe(250)
  })
})
