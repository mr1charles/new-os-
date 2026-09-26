import { describe, expect, it } from "vitest"
import { defaultSpace, parseSpaces, parseSpacesError, waitMessage } from "./login-flow"

describe("spacesd errors", () => {
  it("reads the service's error names", () => {
    expect(
      parseSpacesError(
        "GDBus.Error:org.newos.Spaces1.Error.NoMatch: That password doesn’t open a space.",
      ),
    ).toEqual({
      kind: "nomatch",
    })
    expect(parseSpacesError("GDBus.Error:org.newos.Spaces1.Error.RateLimited: 45")).toEqual({
      kind: "ratelimited",
      seconds: 45,
    })
    expect(
      parseSpacesError(
        "GDBus.Error:org.newos.Spaces1.Error.AccessDenied: Only the login screen and spaces may ask this.",
      ),
    ).toEqual({
      kind: "unavailable",
      message: "Only the login screen and spaces may ask this.",
    })
  })

  it("explains a missing service", () => {
    expect(
      parseSpacesError(
        "GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name is not activatable",
      ).kind,
    ).toBe("unavailable")
  })

  it("words the wait", () => {
    expect(waitMessage(1)).toBe("Try again in 1 second.")
    expect(waitMessage(30)).toBe("Try again in 30 seconds.")
    expect(waitMessage(90)).toBe("Try again in 2 minutes.")
  })
})

describe("spaces", () => {
  it("parses the list and finds the default", () => {
    const spaces = parseSpaces(
      '[{"account":"space-work","name":"Work","accent":"blue","default":false,"last_used":1},{"account":"space-home","name":"Home","accent":"pink","default":true,"last_used":0},{"bad":1}]',
    )
    expect(spaces.map((s) => s.name)).toEqual(["Work", "Home"])
    expect(defaultSpace(spaces)?.name).toBe("Home")
    expect(parseSpaces("not json")).toEqual([])
    expect(defaultSpace([])).toBeUndefined()
  })
})
