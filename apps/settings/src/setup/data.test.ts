import { describe, expect, it } from "vitest"
import { BROWSERS, greetings, LANGUAGES, looksLikeKey, matchLanguage, pinBrowser } from "./data"

describe("setup data", () => {
  it("matches the current language", () => {
    expect(matchLanguage("fr_FR.UTF-8").name).toBe("Français")
    expect(matchLanguage("fr_CA.UTF-8").name).toBe("Français")
    expect(matchLanguage("C.UTF-8").lang).toBe("en_US.UTF-8")
  })

  it("has valid, unique language codes", () => {
    const codes = LANGUAGES.map((l) => l.lang)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(/^[a-z]{2,3}_[A-Z]{2}\.UTF-8$/)
    expect(greetings()[0]).toBe("Hello")
    expect(new Set(greetings()).size).toBe(greetings().length)
  })

  it("swaps the browser in the Dock", () => {
    const brave = BROWSERS.find((b) => b.id === "brave")!
    expect(pinBrowser(["helixos-files", "firefox", "helixos-notes"], brave)).toEqual([
      "helixos-files",
      "com.brave.Browser",
      "helixos-notes",
    ])
    expect(pinBrowser(["helixos-files", "helixos-notes"], brave)).toEqual([
      "helixos-files",
      "com.brave.Browser",
      "helixos-notes",
    ])
    const firefox = BROWSERS[0]!
    expect(pinBrowser(["a", "com.brave.Browser", "b"], firefox)).toEqual(["a", "firefox", "b"])
  })

  it("checks API keys", () => {
    expect(looksLikeKey("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true)
    expect(looksLikeKey("hello")).toBe(false)
  })
})
