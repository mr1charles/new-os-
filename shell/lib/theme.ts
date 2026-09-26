/**
 * Applies the design tokens and shell stylesheets, follows light/dark/auto and the accent
 * color from the config, and tells GTK/libadwaita apps which color scheme to use.
 */
import app from "ags/gtk4/app"
import Gtk from "gi://Gtk?version=4.0"
import { createComputed, createEffect } from "ags"
import { execAsync } from "ags/process"
import { accentColor } from "@helixos/design-tokens"
import tokensLight from "@helixos/design-tokens/dist/gtk-light.css"
import tokensDark from "@helixos/design-tokens/dist/gtk-dark.css"
import base from "../style/base.css"
import bar from "../style/bar.css"
import island from "../style/island.css"
import dock from "../style/dock.css"
import panels from "../style/panels.css"
import launcher from "../style/launcher.css"
import notifications from "../style/notifications.css"
import assistant from "../style/assistant.css"
import login from "../style/login.css"
import { config } from "./config"
import { resolveTheme, type Theme } from "@helixos/sdk/settings-schema"
import { minute } from "./clock"

const STYLES = [base, bar, island, dock, panels, launcher, notifications, assistant, login].join(
  "\n",
)

const Adw = await import("gi://Adw?version=1").then((m) => m.default).catch(() => null)

export const theme = createComputed<Theme>(() =>
  resolveTheme(config().appearance.theme, new Date(minute())),
)
export const accent = createComputed(() => accentColor(config().appearance.accent, theme()))
export const reduceTransparency = createComputed(() => config().appearance.reduceTransparency)
const dockIconSize = createComputed(() => config().dock.iconSize)

/** Dock icon sizes from Settings (base size, then three magnification steps). */
export function dockSizeCss(iconSize: number): string {
  const size = Math.round(iconSize)
  const [m1, m2, m3] = [1.14, 1.32, 1.5].map((f) => Math.round(size * f))
  const shelf = Math.round(size * 1.5) + 26
  return [
    `.dock-icon { -gtk-icon-size: ${size}px; }`,
    `button.dock-item.mag-1 .dock-icon { -gtk-icon-size: ${m1}px; }`,
    `button.dock-item.mag-2 .dock-icon { -gtk-icon-size: ${m2}px; }`,
    `button.dock-item.mag-3 .dock-icon { -gtk-icon-size: ${m3}px; }`,
    `.dock-shelf.dock-bottom { min-height: ${shelf}px; }`,
    `.dock-shelf.dock-left, .dock-shelf.dock-right { min-width: ${shelf}px; }`,
  ].join("\n")
}

export function buildCss(current: Theme, accentHex: string, solid: boolean, iconSize = 44): string {
  const tokens = current === "dark" ? tokensDark : tokensLight
  const overrides = [`:root { --helixos-accent: ${accentHex}; }`]
  if (solid) {
    overrides.push(
      ":root { --helixos-color-material-thin: var(--helixos-color-bg-elevated); --helixos-color-material-regular: var(--helixos-color-bg-elevated); --helixos-color-material-bar: var(--helixos-color-bg-window); }",
    )
  }
  return `${tokens}\n${overrides.join("\n")}\n${STYLES}\n${dockSizeCss(iconSize)}`
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
    app.apply_css(buildCss(current, accent(), reduceTransparency(), dockIconSize()), true)
    applyColorScheme(current)
  })
}
