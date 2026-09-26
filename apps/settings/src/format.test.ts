import { describe, expect, it } from "vitest"
import {
  cleanCpuName,
  cleanGpuName,
  fingerName,
  formatBytes,
  formatMemory,
  isEnterprise,
  looksLike,
  parseMode,
  signalBars,
} from "./format"

describe("format", () => {
  it("formats sizes", () => {
    expect(formatBytes(16387645440)).toBe("15 GB")
    expect(formatBytes(251763412992)).toBe("234 GB")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(0)).toBe("0 KB")
    expect(formatMemory(16387645440)).toBe("16 GB")
  })

  it("cleans hardware names", () => {
    expect(cleanCpuName("11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz")).toBe(
      "Intel Core i3-1125G4 @ 2.00GHz",
    )
    expect(cleanGpuName("Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4]")).toBe(
      "Intel UHD Graphics G4",
    )
    expect(cleanGpuName("Advanced Micro Devices, Inc. [AMD/ATI] Navi")).toBe("AMD AMD/ATI")
  })

  it("names fingers", () => {
    expect(fingerName("right-middle-finger")).toBe("Right middle finger")
  })

  it("reads Wi-Fi details", () => {
    expect([signalBars(90), signalBars(50), signalBars(10)]).toEqual([3, 2, 1])
    expect(isEnterprise("WPA2 802.1X")).toBe(true)
    expect(isEnterprise("WPA2")).toBe(false)
  })

  it("parses display modes", () => {
    expect(parseMode("1920x1080@60.00Hz")).toEqual({
      width: 1920,
      height: 1080,
      refresh: 60,
      value: "1920x1080@60.00",
    })
    expect(parseMode("garbage")).toBeNull()
    expect(looksLike(1920, 1080, 1.25)).toBe("1536 × 864")
  })
})
