/**
 * Shell configuration stored at ~/.config/helixos/shell.json. The Settings app writes the same
 * file, and the shell reloads it live. Unknown or invalid values fall back to defaults so a
 * hand-edited file can never break the desktop.
 */

export type ThemePreference = "light" | "dark" | "auto"
export type Theme = "light" | "dark"

export interface ShellConfig {
  appearance: {
    theme: ThemePreference
    accent: string
    /** Absolute paths. Empty means the built-in HelixOS wallpaper. */
    wallpaperLight: string
    wallpaperDark: string
    reduceTransparency: boolean
  }
  dock: {
    /** Desktop ids, with or without ".desktop". Missing apps are skipped. */
    pinned: string[]
    magnification: boolean
    showRecents: boolean
    position: DockPosition
    /** A floating dock (macOS) or a full-width taskbar with Start, apps, and the clock (Windows). */
    style: DockStyle
    /** Base icon size in pixels. */
    iconSize: number
  }
  bar: {
    /** Hidden when the dock is a taskbar: the taskbar carries the clock and status icons. */
    position: BarPosition
    clock24h: boolean
    showSeconds: boolean
    showBatteryPercent: boolean
  }
  island: {
    notifications: boolean
    media: boolean
    osd: boolean
    battery: boolean
  }
  notifications: {
    doNotDisturb: boolean
  }
  assistant: {
    name: string
    /** Empty means $XDG_RUNTIME_DIR/helixos/assistant.sock. */
    socketPath: string
  }
  nightShift: {
    enabled: boolean
    temperature: number
  }
  windows: {
    /**
     * floating: windows open where you put them (macOS). arrange: windows re-arrange into
     * halves, quarters, and a grid whenever one opens or closes. tiling: Hyprland tiles them.
     */
    layout: WindowLayout
    /** Corner radius of windows in pixels. */
    rounding: number
    /** Space around and between windows in pixels. */
    gaps: number
    blur: boolean
    animations: AnimationLevel
    /** Traffic lights on the left (macOS) or minimize/maximize/close on the right (Windows). */
    controls: WindowControls
  }
}

export type DockPosition = "bottom" | "left" | "right"
export type DockStyle = "dock" | "taskbar"
export type BarPosition = "top" | "bottom"
export type WindowLayout = "floating" | "arrange" | "tiling"
export type AnimationLevel = "full" | "reduced" | "off"
export type WindowControls = "mac" | "windows"

/** Allowed values of the string settings that are choices, by dotted path. */
export const CHOICES: Record<string, readonly string[]> = {
  "appearance.theme": ["light", "dark", "auto"],
  "dock.position": ["bottom", "left", "right"],
  "dock.style": ["dock", "taskbar"],
  "bar.position": ["top", "bottom"],
  "windows.layout": ["floating", "arrange", "tiling"],
  "windows.animations": ["full", "reduced", "off"],
  "windows.controls": ["mac", "windows"],
}

/** Allowed ranges of number settings, by dotted path. Values outside are clamped. */
export const RANGES: Record<string, readonly [number, number]> = {
  "dock.iconSize": [28, 72],
  "windows.rounding": [0, 28],
  "windows.gaps": [0, 40],
  "nightShift.temperature": [2500, 6500],
}

export const DEFAULT_CONFIG: ShellConfig = {
  appearance: {
    theme: "dark",
    accent: "blue",
    wallpaperLight: "",
    wallpaperDark: "",
    reduceTransparency: false,
  },
  dock: {
    pinned: [
      "helixos-files",
      "firefox",
      "helixos-mail",
      "helixos-messages",
      "helixos-notes",
      "helixos-calendar",
      "helixos-music",
      "helixos-appstore",
      "helixos-terminal",
      "kitty",
      "helixos-settings",
    ],
    magnification: true,
    showRecents: true,
    position: "bottom",
    style: "dock",
    iconSize: 44,
  },
  bar: {
    position: "top",
    clock24h: false,
    showSeconds: false,
    showBatteryPercent: true,
  },
  island: {
    notifications: true,
    media: true,
    osd: true,
    battery: true,
  },
  notifications: {
    doNotDisturb: false,
  },
  assistant: {
    name: "Assistant",
    socketPath: "",
  },
  nightShift: {
    enabled: false,
    temperature: 4500,
  },
  windows: {
    layout: "floating",
    rounding: 12,
    gaps: 12,
    blur: true,
    animations: "full",
    controls: "mac",
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge `override` onto `base`, keeping only values whose type matches the default.
 * Arrays replace (they are lists like pinned apps, not objects to merge).
 */
export function mergeConfig<T>(base: T, override: unknown, path = ""): T {
  if (!isRecord(base) || !isRecord(override)) return base
  const result: Record<string, unknown> = { ...base }
  for (const [key, defaultValue] of Object.entries(base)) {
    const value = override[key]
    const at = path ? `${path}.${key}` : key
    if (value === undefined) continue
    if (Array.isArray(defaultValue)) {
      if (Array.isArray(value) && value.every((v) => typeof v === typeof (defaultValue[0] ?? v))) {
        result[key] = [...value]
      }
    } else if (isRecord(defaultValue)) {
      result[key] = mergeConfig(defaultValue, value, at)
    } else if (typeof value === typeof defaultValue) {
      const choices = CHOICES[at]
      const range = RANGES[at]
      if (choices && !choices.includes(value as string)) continue
      if (range && typeof value === "number") {
        if (!Number.isFinite(value)) continue
        result[key] = Math.min(range[1], Math.max(range[0], Math.round(value)))
      } else {
        result[key] = value
      }
    }
  }
  return result as T
}

/** Deep copy for plain JSON data. GJS has no structuredClone. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function parseConfig(text: string | null): ShellConfig {
  if (!text) return cloneJson(DEFAULT_CONFIG)
  try {
    return mergeConfig(cloneJson(DEFAULT_CONFIG), JSON.parse(text))
  } catch {
    return cloneJson(DEFAULT_CONFIG)
  }
}

/** "auto" is light from 07:00 to 19:00 local time, dark otherwise. */
export function resolveTheme(preference: ThemePreference, now: Date = new Date()): Theme {
  if (preference !== "auto") return preference
  const hour = now.getHours()
  return hour >= 7 && hour < 19 ? "light" : "dark"
}
