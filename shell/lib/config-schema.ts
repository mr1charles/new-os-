/**
 * Shell configuration stored at ~/.config/newos/shell.json. The Settings app writes the same
 * file, and the shell reloads it live. Unknown or invalid values fall back to defaults so a
 * hand-edited file can never break the desktop.
 */

export type ThemePreference = "light" | "dark" | "auto"
export type Theme = "light" | "dark"

export interface ShellConfig {
  appearance: {
    theme: ThemePreference
    accent: string
    /** Absolute paths. Empty means the built-in NewOS wallpaper. */
    wallpaperLight: string
    wallpaperDark: string
    reduceTransparency: boolean
  }
  dock: {
    /** Desktop ids, with or without ".desktop". Missing apps are skipped. */
    pinned: string[]
    magnification: boolean
    showRecents: boolean
  }
  bar: {
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
    /** Empty means $XDG_RUNTIME_DIR/newos/assistant.sock. */
    socketPath: string
  }
  nightShift: {
    enabled: boolean
    temperature: number
  }
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
      "newos-files",
      "firefox",
      "newos-mail",
      "newos-messages",
      "newos-notes",
      "newos-calendar",
      "newos-music",
      "newos-appstore",
      "newos-terminal",
      "kitty",
      "newos-settings",
    ],
    magnification: true,
    showRecents: true,
  },
  bar: {
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge `override` onto `base`, keeping only values whose type matches the default.
 * Arrays replace (they are lists like pinned apps, not objects to merge).
 */
export function mergeConfig<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) return base
  const result: Record<string, unknown> = { ...base }
  for (const [key, defaultValue] of Object.entries(base)) {
    const value = override[key]
    if (value === undefined) continue
    if (Array.isArray(defaultValue)) {
      if (Array.isArray(value) && value.every((v) => typeof v === typeof (defaultValue[0] ?? v))) {
        result[key] = [...value]
      }
    } else if (isRecord(defaultValue)) {
      result[key] = mergeConfig(defaultValue, value)
    } else if (typeof value === typeof defaultValue) {
      result[key] = value
    }
  }
  if (isRecord(result.appearance)) {
    const theme = result.appearance.theme
    if (theme !== "light" && theme !== "dark" && theme !== "auto") {
      result.appearance = { ...result.appearance, theme: DEFAULT_CONFIG.appearance.theme }
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
