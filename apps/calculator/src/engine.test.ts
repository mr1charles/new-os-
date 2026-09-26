import { describe, expect, it } from "vitest"
import { answerLocally, expressionFromAssistant, rewritePhrase } from "./engine"
import { convert, parseConversion } from "./units"

describe("units", () => {
  it("converts within a category", () => {
    expect(parseConversion("5 km in miles")!.result).toBeCloseTo(3.10686, 4)
    expect(parseConversion("100 F to C")!.result).toBeCloseTo(37.7778, 3)
    expect(parseConversion("0 c in k")!.result).toBeCloseTo(273.15)
    expect(parseConversion("2 GB in MB")!.result).toBe(2000)
    expect(parseConversion("1 GiB to MiB")!.result).toBe(1024)
    expect(parseConversion("3 cups in ml")!.result).toBeCloseTo(709.76, 1)
    expect(convert(1, "mph", "km/h")!.result).toBeCloseTo(1.609344)
  })

  it("refuses mixed categories and unknown units", () => {
    expect(parseConversion("5 km in kg")).toBeNull()
    expect(parseConversion("5 florps in miles")).toBeNull()
    expect(parseConversion("5 + 3")).toBeNull()
  })
})

describe("phrases", () => {
  it.each([
    ["15% tip on 84", 12.6],
    ["tip of 20% on 50", 10],
    ["84 with a 15% tip", 96.6],
    ["84 plus 15%", 96.6],
    ["84 - 25%", 63],
    ["20% off 80", 64],
    ["what percent of 80 is 20", 25],
    ["20 is what percent of 80", 25],
    ["split 90 between 3", 30],
    ["$84 split 4 ways", 21],
  ])("%s", (input, expected) => {
    expect(answerLocally(input)!.value).toBeCloseTo(expected)
  })

  it("leaves plain math to the evaluator", () => {
    expect(rewritePhrase("2 + 2")).toBeNull()
    expect(answerLocally("2^10")!.text).toBe("1,024")
    expect(answerLocally("sin(90)", { angle: "deg" })!.value).toBeCloseTo(1)
    expect(answerLocally("how tall is everest")).toBeNull()
  })
})

describe("assistant replies", () => {
  it("accepts only arithmetic", () => {
    expect(expressionFromAssistant('{"expression": "3 * 12 + 4"}')).toBe("3 * 12 + 4")
    expect(expressionFromAssistant('Sure! {"expression":"(60/1.5)"}')).toBe("(60/1.5)")
    expect(expressionFromAssistant('{"expression": "require(\\"fs\\")"}')).toBeNull()
    expect(expressionFromAssistant('{"expression": null}')).toBeNull()
    expect(expressionFromAssistant("no json")).toBeNull()
  })
})
