import { describe, expect, it } from "vitest"
import { evaluate, formatNumber, looksLikeMath } from "./math"

describe("evaluate", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["2^3^2", 512],
    ["-2^2", -4],
    ["10 / 4", 2.5],
    ["15% of 84", 12.6],
    ["84 * 15%", 12.6],
    ["sqrt(16) + abs(-2)", 6],
    ["5!", 120],
    ["10 mod 3", 1],
    ["2 × 3 ÷ 4", 1.5],
    ["1,000 + 1", 1001],
    ["2 * pi", Math.PI * 2],
    ["3 + 4 =", 7],
  ])("%s = %d", (input, expected) => {
    expect(evaluate(input)).toBeCloseTo(expected, 10)
  })

  it.each(["", "hello", "1 +", "(1 + 2", "sqrt 4", "1 / 0", "alert(1)", "2 ** 3 ** "])(
    "rejects %j",
    (input) => {
      expect(evaluate(input)).toBeNull()
    },
  )
})

describe("looksLikeMath", () => {
  it("detects expressions but not plain words or numbers", () => {
    expect(looksLikeMath("12 * 7")).toBe(true)
    expect(looksLikeMath("20% of 150")).toBe(true)
    expect(looksLikeMath("sqrt(2)")).toBe(true)
    expect(looksLikeMath("firefox")).toBe(false)
    expect(looksLikeMath("42")).toBe(false)
    expect(looksLikeMath("wi-fi")).toBe(false)
  })
})

describe("formatNumber", () => {
  it("hides floating point noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3")
    expect(formatNumber(1234567)).toBe("1,234,567")
    expect(formatNumber(1 / 3)).toBe("0.3333333333")
    expect(formatNumber(1e21)).toBe("1e+21")
  })
})
