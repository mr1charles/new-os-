/**
 * Apply the user's appearance settings to an app window: light/dark (including "auto") and
 * the accent color, on top of `@newos/design-tokens/dist/tokens.css`.
 */
import { accentColor } from "@newos/design-tokens"
import { resolveTheme, type Theme } from "./settings-schema"
import type { Settings } from "./settings"

export interface AppliedTheme {
  theme: Theme
  accent: string
}

export function themeFor(settings: Settings, now: Date = new Date()): AppliedTheme {
  const theme = resolveTheme(settings.appearance.theme, now)
  return { theme, accent: accentColor(settings.appearance.accent, theme) }
}

/** Set `data-theme`, `--newos-accent`, and reduced transparency on the document root. */
export function applyTheme(settings: Settings, root: HTMLElement = document.documentElement) {
  const { theme, accent } = themeFor(settings)
  root.dataset.theme = theme
  root.style.setProperty("--newos-accent", accent)
  root.style.colorScheme = theme
  root.toggleAttribute("data-reduce-transparency", settings.appearance.reduceTransparency)
  // Window buttons: traffic lights on the left, or Windows-style on the right (@newos/ui).
  root.dataset.controls = settings.windows.controls
  root.style.setProperty("--newos-window-radius", `${settings.windows.rounding}px`)
  return { theme, accent }
}
