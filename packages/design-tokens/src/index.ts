import tokens from "../tokens.json"

export type Theme = "light" | "dark"
export type AccentName = keyof typeof tokens.accents
export type ThemeColors = (typeof tokens.themes)["light"]

export const designTokens = tokens
export const accentNames = Object.keys(tokens.accents) as AccentName[]

/** Resolve the accent hex for a theme, falling back to the default accent. */
export function accentColor(name: string, theme: Theme): string {
  const accent = (tokens.accents as Record<string, { light: string; dark: string }>)[name]
  return (accent ?? tokens.accents[tokens.defaultAccent as AccentName])[theme]
}

/** CSS custom property name for a token, e.g. cssVar("color", "fg") -> "--helixos-color-fg". */
export function cssVar(group: string, key: string): string {
  const kebab = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
  return `--helixos-${group}-${kebab}`
}

export default designTokens
