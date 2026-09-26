import { setMockBackend } from "@newos/sdk"
import { createMockBackend } from "@newos/sdk/mock"
import { SETTINGS_PAGES } from "@newos/sdk/settings-pages"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { App } from "./App"
import { PAGES, SECTIONS, searchPages } from "./pages"

describe("page registry", () => {
  it("has a view for every page the shell can open, each in one section", () => {
    expect(PAGES.map((p) => p.page).sort()).toEqual(SETTINGS_PAGES.map((p) => p.page).sort())
    expect(SECTIONS.flat().sort()).toEqual(PAGES.map((p) => p.page).sort())
  })

  it("searches titles and keywords", () => {
    expect(searchPages("headphones").map((p) => p.page)).toContain("bluetooth")
    expect(searchPages("dark").map((p) => p.page)).toContain("appearance")
    expect(searchPages("zzzz")).toEqual([])
  })
})

describe("every page renders against the mock backend", () => {
  beforeEach(() => setMockBackend(createMockBackend({ latencyMs: 0 })))

  for (const page of SETTINGS_PAGES) {
    it(page.page, async () => {
      window.history.replaceState(null, "", `/?page=${page.page}`)
      render(<App />)
      expect(await screen.findByRole("heading", { level: 1, name: page.title })).toBeTruthy()
      // Let the page's first loads settle so async errors surface in this test.
      await waitFor(() => expect(document.querySelector('[role="alert"]')).toBeNull())
    })
  }
})
