import { describe, expect, it } from "vitest"
import {
  askPrompt,
  bodyRange,
  checkboxMark,
  keywords,
  rankSources,
  shortDate,
  toggleCheckbox,
} from "./logic"

describe("checklists", () => {
  it("finds and toggles task markers", () => {
    expect(checkboxMark("- [ ] milk")).toBe(3)
    expect(checkboxMark("  * [x] eggs")).toBe(5)
    expect(checkboxMark("- milk")).toBeNull()
    expect(toggleCheckbox("- [ ] milk")).toBe("- [x] milk")
    expect(toggleCheckbox("- [X] milk")).toBe("- [ ] milk")
    expect(toggleCheckbox("plain")).toBe("plain")
  })
})

describe("body range", () => {
  it("skips the title and blank lines after it", () => {
    const text = "# Title\n\nBody here"
    const { from, to } = bodyRange(text)
    expect(text.slice(from, to)).toBe("Body here")
    expect(bodyRange("Only title")).toEqual({ from: 10, to: 10 })
  })
})

describe("ask my notes", () => {
  it("picks keywords", () => {
    expect(keywords("What did I plan for Q4?")).toEqual(["plan", "q4"])
    expect(keywords("the and of")).toEqual([])
  })

  it("ranks notes by keyword matches", () => {
    expect(rankSources([["a.md", "b.md"], ["b.md"], ["c.md"]])).toEqual(["b.md", "a.md", "c.md"])
    expect(rankSources([["a.md", "b.md", "c.md"]], 2)).toEqual(["a.md", "b.md"])
  })

  it("builds a grounded prompt", () => {
    const prompt = askPrompt("When is the trip?", [
      { title: 'Trip "plan"', path: "Trip.md", text: "Leave on May 3" },
    ])
    expect(prompt).toContain('<note index="1" title="Trip \'plan\'">\nLeave on May 3\n</note>')
    expect(prompt.endsWith("Question: When is the trip?")).toBe(true)
  })
})

describe("dates", () => {
  const now = new Date(2026, 8, 26, 12, 0).getTime()
  it("formats the list's dates", () => {
    expect(shortDate(now - 10_000, now)).toBe("Just now")
    expect(shortDate(now - 5 * 60_000, now)).toBe("5 min ago")
    expect(shortDate(new Date(2026, 8, 25, 9).getTime(), now)).toBe("Yesterday")
    expect(shortDate(new Date(2025, 0, 2).getTime(), now)).toMatch(/2025/)
  })
})
