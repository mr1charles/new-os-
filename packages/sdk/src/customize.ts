/**
 * Changing the whole look at once: built-in presets ("Windows", "macOS", ...) and requests in
 * plain words ("make it look more like Windows") that the assistant turns into a settings
 * patch. Whatever comes back is validated against the settings schema before it is applied,
 * so the assistant can only change settings that exist, to values that are allowed.
 */
import {
  CHOICES,
  cloneJson,
  LIST_CHOICES,
  DEFAULT_CONFIG,
  mergeConfig,
  RANGES,
  type ShellConfig,
} from "./settings-schema"

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K]
}
export type ConfigPatch = DeepPartial<ShellConfig>

export interface Preset {
  id: string
  name: string
  description: string
  patch: ConfigPatch
}

export const PRESETS: Preset[] = [
  {
    id: "helix",
    name: "HelixOS",
    description: "Floating windows, the Dock, and the menu bar with the Dynamic Island.",
    patch: {
      appearance: { glass: "clear", iconStyle: "default", wallpaperDark: "", wallpaperLight: "" },
      dock: { position: "bottom", style: "dock", iconSize: 44, magnification: true },
      bar: { position: "top" },
      windows: {
        layout: "floating",
        rounding: 12,
        gaps: 12,
        blur: true,
        animations: "full",
        controls: "mac",
      },
    },
  },
  {
    id: "mono",
    name: "Monochrome",
    description: "Dark, graphite, and clear glass icons over a black-and-white wallpaper.",
    patch: {
      appearance: {
        theme: "dark",
        accent: "graphite",
        glass: "clear",
        iconStyle: "clear",
        wallpaperDark: "builtin:helixos-mono.jpg",
      },
      dock: { position: "bottom", style: "dock", magnification: true },
      widgets: { show: true },
      windows: { layout: "floating", rounding: 14, blur: true, controls: "mac" },
    },
  },
  {
    id: "windows",
    name: "Windows",
    description: "A taskbar with Start and the clock, window buttons on the right, snap layouts.",
    patch: {
      appearance: { accent: "blue" },
      dock: { position: "bottom", style: "taskbar", iconSize: 32, magnification: false },
      windows: {
        layout: "arrange",
        rounding: 8,
        gaps: 6,
        blur: true,
        animations: "reduced",
        controls: "windows",
      },
    },
  },
  {
    id: "tiling",
    name: "Tiling",
    description: "Every window tiles automatically, with small gaps and quick animations.",
    patch: {
      dock: { position: "bottom", style: "dock", iconSize: 36, magnification: false },
      bar: { position: "top" },
      windows: {
        layout: "tiling",
        rounding: 6,
        gaps: 4,
        blur: false,
        animations: "reduced",
        controls: "mac",
      },
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Square corners, no blur or animations, a small side dock.",
    patch: {
      appearance: { reduceTransparency: true },
      dock: { position: "left", style: "dock", iconSize: 32, magnification: false },
      windows: { rounding: 0, gaps: 4, blur: false, animations: "off" },
    },
  },
]

/** Apply a patch through the schema's checks. Unknown keys and bad values are dropped. */
export function patchConfig(config: ShellConfig, patch: unknown): ShellConfig {
  return mergeConfig(cloneJson(config), patch)
}

export interface Change {
  path: string
  from: unknown
  to: unknown
}

/** The settings that differ, by dotted path. */
export function diffConfig(before: unknown, after: unknown, path = ""): Change[] {
  if (
    typeof before === "object" &&
    before !== null &&
    !Array.isArray(before) &&
    typeof after === "object" &&
    after !== null &&
    !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...keys].flatMap((k) =>
      diffConfig(
        (before as Record<string, unknown>)[k],
        (after as Record<string, unknown>)[k],
        path ? `${path}.${k}` : k,
      ),
    )
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, from: before, to: after }]
}

/** Settings the assistant may change. Pinned apps and the assistant's own setup stay out. */
const EXCLUDED = new Set([
  "setup.done",
  "widgets.positions",
  "assistant.enabled",
  "dock.pinned",
  "assistant.name",
  "assistant.socketPath",
  "notifications.doNotDisturb",
])

function describeSettings(value: unknown, path = ""): string[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value))
    return Object.entries(value).flatMap(([k, v]) => describeSettings(v, path ? `${path}.${k}` : k))
  if (EXCLUDED.has(path)) return []
  const items = LIST_CHOICES[path]
  if (items) return [`- ${path}: list of ${items.map((c) => `"${c}"`).join(", ")} (in order)`]
  const choices = CHOICES[path]
  const range = RANGES[path]
  const kind = choices
    ? `one of ${choices.map((c) => `"${c}"`).join(", ")}`
    : range
      ? `number ${range[0]}-${range[1]}`
      : typeof value
  return [`- ${path}: ${kind}`]
}

/** What the assistant is told, with the current settings, for `assistant.complete("customize")`. */
export function customizeInput(request: string, current: ShellConfig): string {
  const settings = describeSettings(DEFAULT_CONFIG).join("\n")
  const presets = PRESETS.map((p) => `- ${p.name}: ${JSON.stringify(p.patch)}`).join("\n")
  const accents = "blue, purple, pink, red, orange, yellow, green, graphite"
  return [
    `Request: ${request}`,
    "",
    "Settings you can change (dotted path: type):",
    settings,
    `Accent colors (appearance.accent): ${accents}.`,
    "",
    "Built-in looks you can start from:",
    presets,
    "",
    `Current settings: ${JSON.stringify(current)}`,
  ].join("\n")
}

/**
 * Read the assistant's answer: a JSON object {"patch": {...}, "summary": "..."}, possibly in a
 * code fence. Returns the validated patch result, or null when nothing usable came back.
 */
export function parseCustomization(
  reply: string,
  current: ShellConfig,
): { config: ShellConfig; changes: Change[]; summary: string } | null {
  const start = reply.indexOf("{")
  const end = reply.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  let data: unknown
  try {
    data = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null) return null
  const record = data as Record<string, unknown>
  const patch = (record.patch ?? record) as Record<string, unknown>
  const safe = cloneJson(patch)
  for (const path of EXCLUDED) {
    const [a, b] = path.split(".") as [string, string]
    const section = safe[a]
    if (section && typeof section === "object") delete (section as Record<string, unknown>)[b]
  }
  const config = patchConfig(current, safe)
  const changes = diffConfig(current, config)
  const summary = typeof record.summary === "string" ? record.summary.slice(0, 300) : ""
  return { config, changes, summary }
}
