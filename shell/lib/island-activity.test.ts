import { describe, expect, it } from "vitest"
import { parseActivity, scopedId } from "./island-activity"

describe("app activities", () => {
  it("accepts a well-formed activity and clamps progress", () => {
    expect(
      parseActivity(
        '{"app":"newos-files","icon":"folder","title":"Copying 3 items","subtitle":"to Documents","progress":1.7}',
      ),
    ).toEqual({
      app: "newos-files",
      icon: "folder",
      title: "Copying 3 items",
      subtitle: "to Documents",
      progress: 1,
    })
    expect(parseActivity('{"title":"Working","progress":null}')?.progress).toBeNull()
  })

  it("refuses malformed input and odd icons", () => {
    expect(parseActivity("nope")).toBeNull()
    expect(parseActivity("[1]")).toBeNull()
    expect(parseActivity('{"title":"   "}')).toBeNull()
    expect(parseActivity('{"title":"x","icon":"https://evil.example/i.png"}')?.icon).toBe("")
    expect(parseActivity('{"title":"x","app":"a b;c"}')?.app).toBe("abc")
  })

  it("scopes ids to the sender", () => {
    expect(scopedId(":1.42", "copy")).toBe("app::1.42:copy")
  })
})
