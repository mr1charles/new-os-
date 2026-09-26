import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { kebab, renderGtkCss, renderWebCss, themeDeclarations } from "./build.mjs"

const tokens = JSON.parse(readFileSync(join(__dirname, "..", "tokens.json"), "utf8"))

describe("design tokens", () => {
  it("has every color token in both themes", () => {
    const light = Object.keys(tokens.themes.light).sort()
    const dark = Object.keys(tokens.themes.dark).sort()
    expect(dark).toEqual(light)
  })

  it("has light and dark variants for every accent, and a valid default", () => {
    for (const [name, variants] of Object.entries<{ light: string; dark: string }>(
      tokens.accents,
    )) {
      expect(variants.light, name).toMatch(/^#[0-9A-F]{6}$/i)
      expect(variants.dark, name).toMatch(/^#[0-9A-F]{6}$/i)
    }
    expect(tokens.accents[tokens.defaultAccent]).toBeDefined()
  })

  it("kebab-cases camelCase keys", () => {
    expect(kebab("fgSecondary")).toBe("fg-secondary")
    expect(kebab("largeTitle")).toBe("large-title")
    expect(kebab("body")).toBe("body")
  })

  it("renders web CSS with light defaults, a dark media query and a forced dark theme", () => {
    const css = renderWebCss(tokens)
    expect(css).toContain(":root {")
    expect(css).toContain("--helixos-accent: #007AFF;")
    expect(css).toContain("@media (prefers-color-scheme: dark)")
    expect(css).toContain(':root:not([data-theme="light"])')
    expect(css).toContain(':root[data-theme="dark"]')
    expect(css).toContain("--helixos-color-fg: rgba(255, 255, 255, 0.85);")
    expect(css).toContain("--helixos-radius-md: 14px;")
    expect(css).toContain("--helixos-motion-spring: cubic-bezier(0.2, 0.9, 0.2, 1.05);")
  })

  it("renders one GTK stylesheet per theme with the resolved accent", () => {
    const light = renderGtkCss(tokens, "light")
    const dark = renderGtkCss(tokens, "dark", "purple")
    expect(light).toContain("--helixos-theme: light;")
    expect(light).toContain("--helixos-accent: #007AFF;")
    expect(dark).toContain("--helixos-theme: dark;")
    expect(dark).toContain("--helixos-accent: #BF5AF2;")
    expect(dark).not.toContain("@media")
  })

  it("falls back to the default accent for unknown accent names", () => {
    const lines = themeDeclarations(tokens, "dark", "not-a-color")
    expect(lines[0]).toBe("  --helixos-accent: #0A84FF;")
  })
})
