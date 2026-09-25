/**
 * Launcher (Spotlight) search. Combines apps, Settings pages, a calculator, "Ask the
 * assistant", and web search into one ranked list. Pure TypeScript for Node tests.
 */
import { evaluate, formatNumber, looksLikeMath } from "./math"

export interface SearchableApp {
  entry: string
  name: string
  description: string
  keywords: string[]
  iconName: string
  /** Launch count, used as a small boost. */
  frequency: number
}

export type SearchResult =
  | {
      kind: "app"
      id: string
      title: string
      subtitle: string
      iconName: string
      score: number
      entry: string
    }
  | {
      kind: "setting"
      id: string
      title: string
      subtitle: string
      iconName: string
      score: number
      page: string
    }
  | {
      kind: "calc"
      id: string
      title: string
      subtitle: string
      iconName: string
      score: number
      value: string
    }
  | {
      kind: "assistant"
      id: string
      title: string
      subtitle: string
      iconName: string
      score: number
      prompt: string
    }
  | {
      kind: "web"
      id: string
      title: string
      subtitle: string
      iconName: string
      score: number
      url: string
    }

export interface SettingsPage {
  page: string
  title: string
  keywords: string[]
  iconName: string
}

/** Pages of the Settings app (apps/settings). `newos-settings --page <page>` opens one. */
export const SETTINGS_PAGES: SettingsPage[] = [
  {
    page: "wifi",
    title: "Wi-Fi",
    keywords: ["wireless", "network", "internet", "hotspot"],
    iconName: "network-wireless-symbolic",
  },
  {
    page: "bluetooth",
    title: "Bluetooth",
    keywords: ["headphones", "pair", "devices"],
    iconName: "bluetooth-active-symbolic",
  },
  {
    page: "network",
    title: "Network",
    keywords: ["ethernet", "vpn", "proxy", "dns"],
    iconName: "network-wired-symbolic",
  },
  {
    page: "notifications",
    title: "Notifications",
    keywords: ["alerts", "banners", "island"],
    iconName: "preferences-system-notifications-symbolic",
  },
  {
    page: "focus",
    title: "Focus",
    keywords: ["do not disturb", "dnd", "quiet"],
    iconName: "weather-clear-night-symbolic",
  },
  {
    page: "sound",
    title: "Sound",
    keywords: ["volume", "speakers", "microphone", "audio", "output", "input"],
    iconName: "audio-volume-high-symbolic",
  },
  {
    page: "displays",
    title: "Displays",
    keywords: ["screen", "resolution", "scale", "night shift", "monitor"],
    iconName: "video-display-symbolic",
  },
  {
    page: "appearance",
    title: "Appearance",
    keywords: ["dark mode", "light mode", "accent", "theme", "color"],
    iconName: "applications-graphics-symbolic",
  },
  {
    page: "wallpaper",
    title: "Wallpaper",
    keywords: ["background", "desktop picture"],
    iconName: "preferences-desktop-wallpaper-symbolic",
  },
  {
    page: "dock",
    title: "Desktop & Dock",
    keywords: ["dock", "magnification", "spaces", "desktops", "hot corners"],
    iconName: "view-app-grid-symbolic",
  },
  {
    page: "battery",
    title: "Battery",
    keywords: ["power", "energy", "sleep", "low power", "charging"],
    iconName: "battery-good-symbolic",
  },
  {
    page: "keyboard",
    title: "Keyboard",
    keywords: ["shortcuts", "layout", "input", "typing"],
    iconName: "input-keyboard-symbolic",
  },
  {
    page: "trackpad",
    title: "Trackpad",
    keywords: ["mouse", "gestures", "scrolling", "tap to click", "touchpad"],
    iconName: "input-touchpad-symbolic",
  },
  {
    page: "spaces",
    title: "Users & Spaces",
    keywords: ["dual space", "password", "fingerprint", "face", "login", "account"],
    iconName: "system-users-symbolic",
  },
  {
    page: "assistant",
    title: "Assistant",
    keywords: ["ai", "claude", "ollama", "api key", "model", "siri"],
    iconName: "newos-sparkle-symbolic",
  },
  {
    page: "privacy",
    title: "Privacy & Security",
    keywords: ["permissions", "camera", "location", "firewall"],
    iconName: "security-high-symbolic",
  },
  {
    page: "update",
    title: "Software Update",
    keywords: ["upgrade", "updates", "version"],
    iconName: "software-update-available-symbolic",
  },
  {
    page: "about",
    title: "About",
    keywords: ["storage", "memory", "processor", "hardware", "version"],
    iconName: "help-about-symbolic",
  },
]

/**
 * Score how well `query` matches `text`, 0 (no match) to 1 (exact).
 * Prefix > word-start > substring > in-order subsequence.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0 || t.length === 0) return 0
  if (t === q) return 1
  if (t.startsWith(q)) return 0.95 - Math.min(0.1, (t.length - q.length) * 0.005)
  const words = t.split(/[\s\-_.]+/)
  if (words.some((w) => w.startsWith(q))) return 0.85
  const initials = words.map((w) => w[0] ?? "").join("")
  if (initials.startsWith(q) && q.length >= 2) return 0.8
  const index = t.indexOf(q)
  if (index >= 0) return 0.7 - Math.min(0.1, index * 0.01)

  // Subsequence: every query char appears in order. Score by how tightly they cluster.
  let ti = 0
  let first = -1
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return 0
    if (first < 0) first = found
    last = found
    ti = found + 1
  }
  const span = last - first + 1
  return Math.max(0.2, 0.55 * (q.length / span))
}

function bestScore(query: string, fields: string[]): number {
  let best = 0
  for (const field of fields) best = Math.max(best, fuzzyScore(query, field))
  return best
}

const QUESTION =
  /^(what|what's|whats|how|why|who|when|where|which|can|could|should|is|are|do|does|explain|summarize|write|draft|translate|turn|set|remind|make|find|tell|open|create|help)\b/i

/** Queries that read like requests go to the assistant first. */
export function looksLikeRequest(query: string): boolean {
  const q = query.trim()
  if (q.endsWith("?")) return true
  return QUESTION.test(q) && q.split(/\s+/).length >= 3
}

export interface BuildOptions {
  assistantName?: string
  maxApps?: number
  maxSettings?: number
}

export function buildResults(
  query: string,
  apps: SearchableApp[],
  options: BuildOptions = {},
): SearchResult[] {
  const q = query.trim()
  if (q.length === 0) return []
  const { assistantName = "Assistant", maxApps = 6, maxSettings = 3 } = options
  const results: SearchResult[] = []

  if (looksLikeMath(q)) {
    const value = evaluate(q)
    if (value !== null) {
      const formatted = formatNumber(value)
      results.push({
        kind: "calc",
        id: "calc",
        title: `= ${formatted}`,
        subtitle: "Calculator · press Enter to copy",
        iconName: "accessories-calculator-symbolic",
        score: 2,
        value: formatted.replace(/,/g, ""),
      })
    }
  }

  const appResults = apps
    .map((app) => {
      const nameScore = fuzzyScore(q, app.name)
      const otherScore = bestScore(q, [app.entry.replace(/\.desktop$/, ""), ...app.keywords]) * 0.8
      const descScore = fuzzyScore(q, app.description) * 0.5
      const base = Math.max(nameScore, otherScore, descScore)
      const boost = base > 0 ? Math.min(0.08, Math.log10(1 + app.frequency) * 0.04) : 0
      return { app, score: base + boost }
    })
    .filter((r) => r.score >= 0.3)
    .sort((a, b) => b.score - a.score || a.app.name.localeCompare(b.app.name))
    .slice(0, maxApps)

  for (const { app, score } of appResults) {
    results.push({
      kind: "app",
      id: `app:${app.entry}`,
      title: app.name,
      subtitle: app.description || "Application",
      iconName: app.iconName || "application-x-executable",
      score,
      entry: app.entry,
    })
  }

  const settingResults = SETTINGS_PAGES.map((page) => ({
    page,
    score: Math.max(fuzzyScore(q, page.title), bestScore(q, page.keywords) * 0.9) * 0.95,
  }))
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSettings)

  for (const { page, score } of settingResults) {
    results.push({
      kind: "setting",
      id: `setting:${page.page}`,
      title: page.title,
      subtitle: "Settings",
      iconName: page.iconName,
      score,
      page: page.page,
    })
  }

  const request = looksLikeRequest(q)
  results.push({
    kind: "assistant",
    id: "assistant",
    title: `Ask ${assistantName}: “${q}”`,
    subtitle: request
      ? "Sounds like a question for the assistant"
      : "Get an answer or have it done for you",
    iconName: "newos-sparkle-symbolic",
    score: request ? 1.5 : 0.1,
    prompt: q,
  })

  results.push({
    kind: "web",
    id: "web",
    title: `Search the web for “${q}”`,
    subtitle: "Opens in your browser",
    iconName: "web-browser-symbolic",
    score: 0.05,
    url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  })

  return results.sort((a, b) => b.score - a.score)
}
