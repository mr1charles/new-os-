/**
 * Liquid Glass and icon styles (Settings → Appearance), as CSS appended after the shell's own.
 * Pure, tested in Node.
 *
 * - Clear glass: see-through surfaces with a bright rim, the wallpaper blurred behind.
 * - Tinted glass: frosted, more opaque, and tinted with the accent color.
 * - Icon & widget style: app icons as designed, darker, clear (monochrome glass), or tinted
 *   with the accent; widgets follow.
 */
import type { GlassStyle, IconStyle, Theme } from "@helixos/sdk/settings-schema"

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6)
  const n = Number.parseInt(full, 16)
  return Number.isNaN(n) ? [10, 132, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Hue of a color in degrees (0-360). */
export function hueOf(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}

/** `base` mixed toward `accent` by `amount`, as rgba() with `alpha`. */
function mix(
  base: [number, number, number],
  accent: string,
  amount: number,
  alpha: number,
): string {
  const a = rgb(accent)
  const c = base.map((v, i) => Math.round(v * (1 - amount) + a[i]! * amount))
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
}

/** The CSS filter for app icons in each style. `sepia()` starts near 38°; rotate to the accent. */
export function iconFilter(style: IconStyle, accentHex: string): string | null {
  switch (style) {
    case "default":
      return null
    case "dark":
      return "brightness(0.82) contrast(1.12) saturate(0.9)"
    case "clear":
      return "grayscale(1) brightness(1.35) contrast(0.9) opacity(0.9)"
    case "tinted":
      return `grayscale(1) sepia(1) hue-rotate(${Math.round(hueOf(accentHex) - 38)}deg) saturate(2.4) brightness(0.95)`
  }
}

const ICONS = [".dock-icon", "button.grid-app image", ".launcher-result image"]

export function glassCss(options: {
  glass: GlassStyle
  iconStyle: IconStyle
  theme: Theme
  accentHex: string
  /** Reduce transparency: solid surfaces, no glass. */
  solid: boolean
}): string {
  const { glass, iconStyle, theme, accentHex, solid } = options
  const dark = theme === "dark"
  const out: string[] = []
  if (!solid) {
    const base: [number, number, number] = dark ? [30, 30, 32] : [246, 246, 248]
    const rim = dark ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.75)"
    if (glass === "clear") {
      out.push(
        `:root { --helixos-color-material-thin: rgba(${base.join(", ")}, 0.32); --helixos-color-material-regular: rgba(${base.join(", ")}, 0.42); --helixos-color-material-thick: rgba(${base.join(", ")}, 0.62); --helixos-color-material-bar: rgba(${base.join(", ")}, 0.26); }`,
      )
    } else {
      out.push(
        `:root { --helixos-color-material-thin: ${mix(base, accentHex, 0.18, 0.62)}; --helixos-color-material-regular: ${mix(base, accentHex, 0.2, 0.74)}; --helixos-color-material-thick: ${mix(base, accentHex, 0.16, 0.88)}; --helixos-color-material-bar: ${mix(base, accentHex, 0.22, 0.6)}; }`,
      )
    }
    // The glass rim: a light top edge and a hairline all around.
    out.push(
      `.panel, .dock, .island, .desktop-widget, .widget-gallery { box-shadow: inset 0 1px ${rim}, inset 0 0 0 1px rgba(255, 255, 255, ${glass === "clear" ? 0.1 : 0.06}), 0 10px 30px rgba(0, 0, 0, 0.28); }`,
    )
  }
  // Widgets follow the icon style.
  const widgetBg: Record<IconStyle, string> = {
    default: dark ? "rgba(28, 28, 30, 0.55)" : "rgba(40, 40, 44, 0.45)",
    dark: "rgba(12, 12, 14, 0.78)",
    // Clear still needs enough frost to read white text over a bright wallpaper.
    clear: "rgba(18, 18, 20, 0.34)",
    tinted: mix([28, 28, 30], accentHex, 0.35, 0.6),
  }
  out.push(`.desktop-widget { background: ${solid ? "rgb(36, 36, 38)" : widgetBg[iconStyle]}; }`)
  if (iconStyle === "clear" && !solid)
    out.push(".desktop-widget label { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45); }")
  const filter = iconFilter(iconStyle, accentHex)
  if (filter) out.push(`${ICONS.join(", ")} { filter: ${filter}; }`)
  return out.join("\n")
}
