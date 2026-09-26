import { describe, expect, it } from "vitest"
import {
  buildResults,
  flathubAppId,
  fuzzyScore,
  looksLikeRequest,
  type SearchableApp,
} from "./search"

const apps: SearchableApp[] = [
  {
    entry: "firefox.desktop",
    name: "Firefox",
    description: "Browse the web",
    keywords: ["internet", "browser"],
    iconName: "firefox",
    frequency: 20,
  },
  {
    entry: "helixos-files.desktop",
    name: "Files",
    description: "Browse your files",
    keywords: ["folder", "manager"],
    iconName: "folder",
    frequency: 3,
  },
  {
    entry: "helixos-terminal.desktop",
    name: "Terminal",
    description: "Command line",
    keywords: ["shell", "console"],
    iconName: "terminal",
    frequency: 0,
  },
  {
    entry: "org.gnome.Calculator.desktop",
    name: "Calculator",
    description: "",
    keywords: ["math"],
    iconName: "calc",
    frequency: 0,
  },
]

describe("fuzzyScore", () => {
  it("ranks exact > prefix > word start > substring > subsequence", () => {
    const exact = fuzzyScore("files", "Files")
    const prefix = fuzzyScore("fi", "Files")
    const word = fuzzyScore("up", "Software Update")
    const sub = fuzzyScore("ile", "Files")
    const subseq = fuzzyScore("fls", "Files")
    expect(exact).toBe(1)
    expect(prefix).toBeLessThan(exact)
    expect(word).toBeLessThan(prefix)
    expect(sub).toBeLessThan(word)
    expect(subseq).toBeLessThan(sub)
    expect(subseq).toBeGreaterThan(0)
    expect(fuzzyScore("xyz", "Files")).toBe(0)
  })
})

describe("buildResults", () => {
  it("returns nothing for an empty query", () => {
    expect(buildResults("  ", apps)).toEqual([])
  })

  it("puts the best app first for app names", () => {
    const results = buildResults("fire", apps)
    expect(results[0]?.kind).toBe("app")
    expect(results[0]?.title).toBe("Firefox")
  })

  it("finds apps through keywords", () => {
    const results = buildResults("shell", apps)
    expect(results.find((r) => r.kind === "app")?.title).toBe("Terminal")
  })

  it("shows a calculator result first for math", () => {
    const results = buildResults("12 * 12", apps)
    expect(results[0]).toMatchObject({ kind: "calc", title: "= 144", value: "144" })
  })

  it("finds settings pages by keyword", () => {
    const results = buildResults("dark mode", apps)
    expect(results.some((r) => r.kind === "setting" && r.page === "appearance")).toBe(true)
  })

  it("routes questions to the assistant first and always offers web search", () => {
    const results = buildResults("what is the weather tomorrow?", apps, { assistantName: "Nova" })
    expect(results[0]).toMatchObject({
      kind: "assistant",
      title: "Ask Nova: “what is the weather tomorrow?”",
    })
    expect(results.at(-1)?.kind).toBe("web")
  })
})

describe("looksLikeRequest", () => {
  it("recognizes questions and commands", () => {
    expect(looksLikeRequest("how do I change my wallpaper")).toBe(true)
    expect(looksLikeRequest("turn on do not disturb")).toBe(true)
    expect(looksLikeRequest("weather?")).toBe(true)
    expect(looksLikeRequest("firefox")).toBe(false)
    expect(looksLikeRequest("set")).toBe(false)
  })
})

describe("Flathub", () => {
  it("offers to install from a pasted Flathub link", () => {
    expect(flathubAppId("https://flathub.org/apps/com.spotify.Client")).toBe("com.spotify.Client")
    expect(flathubAppId("https://flathub.org/en/apps/details/org.gimp.GIMP?x=1")).toBe(
      "org.gimp.GIMP",
    )
    expect(flathubAppId("appstream://org.gimp.GIMP.desktop")).toBe("org.gimp.GIMP")
    expect(flathubAppId("https://flathub.org/apps/search?q=x")).toBeNull()
    expect(flathubAppId("spotify")).toBeNull()
    const results = buildResults("https://flathub.org/apps/com.spotify.Client", [])
    expect(results[0]).toMatchObject({
      kind: "install",
      target: "https://flathub.org/apps/com.spotify.Client",
    })
  })

  it("suggests Flathub for apps that aren't installed", () => {
    expect(buildResults("spotify", []).some((r) => r.id === "flathub")).toBe(true)
    expect(buildResults("firefox", apps).some((r) => r.id === "flathub")).toBe(false)
  })
})
