import { describe, expect, it } from "vitest"
import { glassCss, hueOf, iconFilter } from "./glass"

describe("glass", () => {
  it("finds hues", () => {
    expect(hueOf("#ff0000")).toBe(0)
    expect(hueOf("#00ff00")).toBe(120)
    expect(hueOf("#0a84ff")).toBe(210)
    expect(hueOf("#888")).toBe(0)
  })

  it("filters icons by style", () => {
    expect(iconFilter("default", "#0a84ff")).toBeNull()
    expect(iconFilter("clear", "#0a84ff")).toContain("grayscale(1)")
    expect(iconFilter("tinted", "#0a84ff")).toContain("hue-rotate(172deg)")
  })

  it("makes clear glass see-through and tinted glass accent-colored", () => {
    const clear = glassCss({
      glass: "clear",
      iconStyle: "default",
      theme: "dark",
      accentHex: "#0a84ff",
      solid: false,
    })
    expect(clear).toContain("--helixos-color-material-bar: rgba(30, 30, 32, 0.26)")
    expect(clear).not.toContain("filter:")
    const tinted = glassCss({
      glass: "tinted",
      iconStyle: "tinted",
      theme: "dark",
      accentHex: "#ff0000",
      solid: false,
    })
    expect(tinted).toMatch(/material-regular: rgba\(75, 24, 26, 0\.74\)/)
    expect(tinted).toContain(".dock-icon")
    const solid = glassCss({
      glass: "clear",
      iconStyle: "default",
      theme: "dark",
      accentHex: "#0a84ff",
      solid: true,
    })
    expect(solid).not.toContain("material")
  })
})
