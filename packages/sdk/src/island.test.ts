import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LiveActivity } from "./island"
import type { IslandActivity } from "./commands"

const base: IslandActivity = {
  app: "helixos-files",
  icon: "folder",
  title: "Copying",
  subtitle: "",
  progress: 0,
}

describe("LiveActivity", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("sends at most a few updates a second, always ending with the latest", () => {
    const show = vi.fn(() => Promise.resolve(null))
    const end = vi.fn(() => Promise.resolve(null))
    const live = new LiveActivity("copy", base, 250, { show, end })
    expect(show).toHaveBeenCalledTimes(1)
    for (let i = 1; i <= 10; i++) live.update({ progress: i / 10 })
    expect(show).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(250)
    expect(show).toHaveBeenCalledTimes(2)
    expect(show).toHaveBeenLastCalledWith("copy", { ...base, progress: 1 })
    live.end()
    live.update({ progress: 0.5 })
    vi.advanceTimersByTime(1000)
    expect(show).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledOnce()
  })

  it("drops a pending update when ended", () => {
    const show = vi.fn(() => Promise.resolve(null))
    const end = vi.fn(() => Promise.resolve(null))
    const live = new LiveActivity("x", base, 250, { show, end })
    live.update({ title: "Almost" })
    live.end()
    vi.advanceTimersByTime(500)
    expect(show).toHaveBeenCalledTimes(1)
  })
})
