import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@newos/sdk/settings-schema"
import { windowStyleConf } from "./window-style"

const withWindows = (
  windows: Partial<typeof DEFAULT_CONFIG.windows>,
  reduceTransparency = false,
) => ({
  appearance: { ...DEFAULT_CONFIG.appearance, reduceTransparency },
  windows: { ...DEFAULT_CONFIG.windows, ...windows },
})

describe("windowStyleConf", () => {
  it("floats windows unless tiling", () => {
    expect(windowStyleConf(withWindows({ layout: "floating" }))).toContain(
      "windowrule = float on, match:class .*",
    )
    expect(windowStyleConf(withWindows({ layout: "arrange" }))).toContain(
      "windowrule = float on, match:class .*",
    )
    const tiling = windowStyleConf(withWindows({ layout: "tiling" }))
    expect(tiling).not.toContain("match:class .*")
    expect(tiling).toContain("Picture-in-Picture")
  })

  it("writes gaps, rounding, blur, and animations", () => {
    const conf = windowStyleConf(
      withWindows({ gaps: 7, rounding: 0, blur: true, animations: "off" }, true),
    )
    expect(conf).toContain("gaps_in = 4")
    expect(conf).toContain("gaps_out = 7")
    expect(conf).toContain("rounding = 0")
    expect(conf).toMatch(/blur \{\n\s+enabled = false/)
    expect(conf).toContain("enabled = false\n}")
    expect(windowStyleConf(withWindows({ animations: "full" }))).not.toContain("animation =")
  })
})
