import { describe, expect, it } from "vitest"
import { shouldPlayAtLogin, STARTUP_STEPS, startupTimeline } from "./startup"

describe("startup animation", () => {
  it("runs its beats in order and ends", () => {
    const times = STARTUP_STEPS.map((s) => s.at)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(STARTUP_STEPS.at(-1)?.name).toBe("done")
    // The name has time to slide out before the flash.
    const name = STARTUP_STEPS.find((s) => s.name === "name")!.at
    const flash = STARTUP_STEPS.find((s) => s.name === "flash")!.at
    expect(flash - name).toBeGreaterThanOrEqual(750)
  })

  it("plays once per login unless the login screen already did", () => {
    expect(shouldPlayAtLogin({ enabled: true, alreadyPlayed: false, fromGreeter: false })).toBe(
      true,
    )
    expect(shouldPlayAtLogin({ enabled: true, alreadyPlayed: true, fromGreeter: false })).toBe(
      false,
    )
    expect(shouldPlayAtLogin({ enabled: true, alreadyPlayed: false, fromGreeter: true })).toBe(
      false,
    )
    expect(shouldPlayAtLogin({ enabled: false, alreadyPlayed: false, fromGreeter: false })).toBe(
      false,
    )
  })
})

describe("after the boot splash", () => {
  it("continues with the logo already showing", () => {
    const steps = startupTimeline(true)
    expect(steps.map((s) => s.name)).toEqual(["name", "flash", "out", "done"])
    expect(steps[0]!.at).toBe(250)
    expect(startupTimeline(false)).toBe(STARTUP_STEPS)
  })
})
