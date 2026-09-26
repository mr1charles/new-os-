import { describe, expect, it } from "vitest"
import { arrange, fitInside, nextZone, usableArea, zoneOf, zoneRect } from "./snap"

const area = { x: 0, y: 30, w: 1920, h: 1050 }

describe("snap zones", () => {
  it("splits the usable area with gaps", () => {
    expect(zoneRect("left", area, 10)).toEqual({ x: 10, y: 40, w: 945, h: 1030 })
    expect(zoneRect("right", area, 10)).toEqual({ x: 965, y: 40, w: 945, h: 1030 })
    expect(zoneRect("bottom-right", area, 10)).toEqual({ x: 965, y: 560, w: 945, h: 510 })
    const thirds = ["left-third", "center-third", "right-third"] as const
    const [a, b, c] = thirds.map((z) => zoneRect(z, area, 10))
    expect(a!.x + a!.w + 10).toBe(b!.x)
    expect(c!.x + c!.w).toBe(1910)
  })

  it("recognizes a window's zone", () => {
    expect(zoneOf(zoneRect("top-left", area, 10), area, 10)).toBe("top-left")
    expect(zoneOf({ x: 100, y: 100, w: 500, h: 400 }, area, 10)).toBeNull()
  })

  it("steps through zones like Windows", () => {
    expect(nextZone(null, "left")).toBe("left")
    expect(nextZone("left", "up")).toBe("top-left")
    expect(nextZone("right", "left")).toBe("center")
    expect(nextZone("top-left", "right")).toBe("top-right")
    expect(nextZone("maximize", "down")).toBe("center")
  })
})

describe("arrange", () => {
  it("uses halves and quarters for a few windows, a grid for many", () => {
    expect(arrange(1, area, 0)).toEqual([{ x: 0, y: 30, w: 1920, h: 1050 }])
    expect(arrange(2, area, 0).map((r) => r.w)).toEqual([960, 960])
    expect(arrange(3, area, 0).map((r) => [r.w, r.h])).toEqual([
      [960, 1050],
      [960, 525],
      [960, 525],
    ])
    const five = arrange(5, area, 0)
    expect(five).toHaveLength(5)
    expect(five.slice(0, 3).every((r) => r.w === 640)).toBe(true)
    expect(five.slice(3).every((r) => r.w === 960)).toBe(true)
    expect(arrange(0, area, 0)).toEqual([])
  })
})

describe("usableArea", () => {
  it("removes the bar and scales", () => {
    const m = { x: 0, y: 0, width: 2880, height: 1800, scale: 1.5, reserved: [0, 35, 0, 0] }
    expect(usableArea(m)).toEqual({ x: 0, y: 35, w: 1920, h: 1165 })
  })
})

describe("fitInside", () => {
  it("keeps windows that can't shrink on screen", () => {
    const small = { x: 0, y: 30, w: 469, h: 380 }
    expect(fitInside({ x: 240, y: 230, w: 220, h: 170 }, { w: 360, h: 480 }, small)).toEqual({
      x: 109,
      y: 30,
      w: 360,
      h: 480,
    })
    expect(fitInside({ x: 10, y: 40, w: 200, h: 100 }, { w: 150, h: 80 }, small)).toEqual({
      x: 10,
      y: 40,
      w: 200,
      h: 100,
    })
  })
})
