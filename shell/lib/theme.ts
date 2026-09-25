/**
 * Applies the design tokens and shell stylesheets, follows light/dark/auto and the accent
 * color from the config, and tells GTK/libadwaita apps which color scheme to use.
 */
import app from "ags/gtk4/app"
import Gtk from "gi://Gtk?version=4.0"
import { createComputed, createEffect } from "ags"
import { execAsync } from "ags/process"
import { accentColor } from "@newos/design-tokens"
import tokensLight from "@newos/design-tokens/dist/gtk-light.css"
import tokensDark from "@newos/design-tokens/dist/gtk-dark.css"
import base from "../style/base.css"
import bar from "../style/bar.css"
import island from "../style/island.css"
import dock from "../style/dock.css"
import panels from "../style/panels.css"
import launcher from "../style/launcher.css"
import notifications from "../style/notifications.css"
import assistant from "../style/assistant.css"
import { config } from "./config"
import { resolveTheme, type Theme } from "./config-schema"
import { minute } from "./clock"

const STYLES = [base, bar, island, dock, panels, launcher, notifications, assistant].join("\n")

const Adw = await import("gi://Adw?version=1").then((m) => m.default).catch(() => null)

export const theme = createComputed<Theme>(() =>
  resolveTheme(config().appearance.theme, new Date(minute())),
)
export const accent = createComputed(() => accentColor(config().appearance.accent, theme()))
export const reduceTransparency = createComputed(() => config().appearance.reduceTransparency)

export function buildCss(current: Theme, accentHex: string, solid: boolean): string {
  const tokens = current === "dark" ? tokensDark : tokensLight
  const overrides = [`:root { --newos-accent: ${accentHex}; }`]
  if (solid) {
    overrides.push(
      ":root { --newos-color-material-thin: var(--newos-color-bg-elevated); --newos-color-material-regular: var(--newos-color-bg-elevated); --newos-color-material-bar: var(--newos-color-bg-window); }",
    )
  }
  return `${tokens}\n${overrides.join("\n")}\n${STYLES}`
}

function applyColorScheme(current: Theme) {
  if (Adw) {
    Adw.StyleManager.get_default().colorScheme =
      current === "dark" ? Adw.ColorScheme.FORCE_DARK : Adw.ColorScheme.FORCE_LIGHT
  } else {
    const settings = Gtk.Settings.get_default()
    if (settings) settings.gtkApplicationPreferDarkTheme = current === "dark"
  }
  // Apps (GTK4/libadwaita, portals, Qt via the portal) read this setting.
  execAsync([
    "gsettings",
    "set",
    "org.gnome.desktop.interface",
    "color-scheme",
    current === "dark" ? "prefer-dark" : "prefer-light",
  ]).catch(() => undefined)
}

/** Call once inside the app's root scope. */
export function setupTheme() {
  createEffect(() => {
    const current = theme()
    app.apply_css(buildCss(current, accent(), reduceTransparency()), true)
    applyColorScheme(current)
  })
}
