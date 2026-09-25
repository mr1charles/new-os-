import { describe, expect, it } from "vitest"
import { escapeMarkup, inlineToPango, markdownToPango } from "./markdown"

describe("markdownToPango", () => {
  it("escapes markup characters", () => {
    expect(escapeMarkup(`<b>"x" & 'y'</b>`)).toBe(
      "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;",
    )
    expect(markdownToPango("1 < 2 & 3 > 2")).toBe("1 &lt; 2 &amp; 3 &gt; 2")
  })

  it("formats emphasis and code", () => {
    expect(inlineToPango("**bold** and *italic* and `a<b`")).toBe(
      "<b>bold</b> and <i>italic</i> and <tt>a&lt;b</tt>",
    )
    expect(inlineToPango("`**not bold**`")).toBe("<tt>**not bold**</tt>")
    expect(inlineToPango("~~gone~~")).toBe("<s>gone</s>")
    expect(inlineToPango("snake_case_name stays")).toBe("snake_case_name stays")
    expect(inlineToPango("2 * 3 * 4")).toBe("2 * 3 * 4")
  })

  it("formats links with escaped urls", () => {
    expect(inlineToPango("see [docs](https://example.com/a?b=1&c=2)")).toBe(
      'see <a href="https://example.com/a?b=1&amp;c=2">docs</a>',
    )
  })

  it("formats block elements", () => {
    const md = [
      "# Title",
      "- one",
      "  - two",
      "1. first",
      "> quoted",
      "```",
      "let x = <1>",
      "```",
    ].join("\n")
    expect(markdownToPango(md)).toBe(
      [
        '<span size="large"><b>Title</b></span>',
        "• one",
        "  • two",
        "1. first",
        "<i>quoted</i>",
        "<tt>let x = &lt;1&gt;</tt>",
      ].join("\n"),
    )
  })

  it("renders an unterminated code fence while streaming", () => {
    expect(markdownToPango("```\nls -la")).toBe("<tt>ls -la</tt>")
  })
})
