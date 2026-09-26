// Renders tokens.json into:
//   dist/tokens.css      web CSS variables, light + dark (apps, packages/ui)
//   dist/gtk-light.css   GTK4 CSS custom properties, light theme (shell)
//   dist/gtk-dark.css    GTK4 CSS custom properties, dark theme (shell)
//   dist/tokens.json     copy of the source for runtime consumers
//
// GTK 4.16+ understands `:root { --name: value }` and `var(--name)`.
// Plain Node, no dependencies, so it runs the same in CI and on the laptop.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PREFIX = "helixos"

/** @param {string} key */
export function kebab(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
}

/**
 * Flatten a group of tokens into `--helixos-<group>-<key>` declarations.
 * @param {string} group
 * @param {Record<string, string>} values
 * @returns {string[]}
 */
export function declarations(group, values) {
  return Object.entries(values).map(
    ([key, value]) => `  --${PREFIX}-${group}-${kebab(key)}: ${value};`,
  )
}

/**
 * Theme independent tokens: typography, radii, spacing, blur, motion, every accent color.
 * @param {any} tokens
 * @returns {string[]}
 */
export function staticDeclarations(tokens) {
  const lines = [
    `  --${PREFIX}-font-family: ${tokens.font.family};`,
    `  --${PREFIX}-font-mono: ${tokens.font.mono};`,
    ...declarations("font-size", tokens.font.size),
    ...declarations("font-weight", tokens.font.weight),
    ...declarations("radius", tokens.radius),
    ...declarations("space", tokens.space),
    ...declarations("blur", tokens.blur),
    ...declarations("motion", tokens.motion),
  ]
  for (const [name, variants] of Object.entries(tokens.accents)) {
    lines.push(`  --${PREFIX}-accent-${name}-light: ${variants.light};`)
    lines.push(`  --${PREFIX}-accent-${name}-dark: ${variants.dark};`)
  }
  return lines
}

/**
 * Theme dependent tokens plus the resolved accent.
 * @param {any} tokens
 * @param {"light" | "dark"} theme
 * @param {string} [accent]
 * @returns {string[]}
 */
export function themeDeclarations(tokens, theme, accent = tokens.defaultAccent) {
  const variants = tokens.accents[accent] ?? tokens.accents[tokens.defaultAccent]
  return [
    `  --${PREFIX}-accent: ${variants[theme]};`,
    `  --${PREFIX}-theme: ${theme};`,
    ...declarations("color", tokens.themes[theme]),
  ]
}

/**
 * Web stylesheet. Light by default, dark through the system setting unless the page
 * forces a theme with data-theme="light" | "dark" on <html>.
 * @param {any} tokens
 */
export function renderWebCss(tokens) {
  const light = themeDeclarations(tokens, "light")
  const dark = themeDeclarations(tokens, "dark")
  return [
    "/* Generated from packages/design-tokens/tokens.json. Do not edit by hand. */",
    ":root {",
    ...staticDeclarations(tokens),
    ...light,
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    ...dark.map((l) => "  " + l),
    "  }",
    "}",
    "",
    ':root[data-theme="dark"] {',
    ...dark,
    "}",
    "",
  ].join("\n")
}

/**
 * GTK4 stylesheet for one theme. The shell loads gtk-light.css or gtk-dark.css and
 * reloads when Appearance changes, so no media query is needed here.
 * @param {any} tokens
 * @param {"light" | "dark"} theme
 * @param {string} [accent]
 */
export function renderGtkCss(tokens, theme, accent) {
  return [
    `/* Generated from packages/design-tokens/tokens.json (${theme}). Do not edit by hand. */`,
    ":root {",
    ...staticDeclarations(tokens),
    ...themeDeclarations(tokens, theme, accent),
    "}",
    "",
  ].join("\n")
}

/**
 * @param {string} tokensPath
 * @param {string} outDir
 */
export function build(tokensPath, outDir) {
  const tokens = JSON.parse(readFileSync(tokensPath, "utf8"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "tokens.css"), renderWebCss(tokens))
  writeFileSync(join(outDir, "gtk-light.css"), renderGtkCss(tokens, "light"))
  writeFileSync(join(outDir, "gtk-dark.css"), renderGtkCss(tokens, "dark"))
  writeFileSync(join(outDir, "tokens.json"), JSON.stringify(tokens, null, 2) + "\n")
  return tokens
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, "..")
  const tokens = build(join(root, "tokens.json"), join(root, "dist"))
  console.log(
    `design-tokens: wrote dist/ (${Object.keys(tokens.themes).length} themes, ${Object.keys(tokens.accents).length} accents)`,
  )
}
