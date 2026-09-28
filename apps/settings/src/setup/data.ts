/** What the first-run Setup offers. Pure data and helpers, tested in Node. */

export interface Language {
  lang: string
  name: string
  /** In English, for search and screen readers. */
  english: string
  /** Hyprland/xkb layout that usually goes with it. */
  keyboard: string
  hello: string
}

export const LANGUAGES: Language[] = [
  {
    lang: "en_US.UTF-8",
    name: "English (US)",
    english: "English (US)",
    keyboard: "us",
    hello: "Hello",
  },
  {
    lang: "en_GB.UTF-8",
    name: "English (UK)",
    english: "English (UK)",
    keyboard: "gb",
    hello: "Hello",
  },
  {
    lang: "es_ES.UTF-8",
    name: "Español (España)",
    english: "Spanish (Spain)",
    keyboard: "es",
    hello: "Hola",
  },
  {
    lang: "es_MX.UTF-8",
    name: "Español (Latinoamérica)",
    english: "Spanish (Latin America)",
    keyboard: "latam",
    hello: "Hola",
  },
  { lang: "fr_FR.UTF-8", name: "Français", english: "French", keyboard: "fr", hello: "Bonjour" },
  { lang: "de_DE.UTF-8", name: "Deutsch", english: "German", keyboard: "de", hello: "Hallo" },
  { lang: "it_IT.UTF-8", name: "Italiano", english: "Italian", keyboard: "it", hello: "Ciao" },
  {
    lang: "pt_BR.UTF-8",
    name: "Português (Brasil)",
    english: "Portuguese (Brazil)",
    keyboard: "br",
    hello: "Olá",
  },
  {
    lang: "pt_PT.UTF-8",
    name: "Português (Portugal)",
    english: "Portuguese (Portugal)",
    keyboard: "pt",
    hello: "Olá",
  },
  { lang: "nl_NL.UTF-8", name: "Nederlands", english: "Dutch", keyboard: "us", hello: "Hallo" },
  { lang: "pl_PL.UTF-8", name: "Polski", english: "Polish", keyboard: "pl", hello: "Cześć" },
  { lang: "tr_TR.UTF-8", name: "Türkçe", english: "Turkish", keyboard: "tr", hello: "Merhaba" },
  { lang: "sv_SE.UTF-8", name: "Svenska", english: "Swedish", keyboard: "se", hello: "Hej" },
  { lang: "ru_RU.UTF-8", name: "Русский", english: "Russian", keyboard: "us,ru", hello: "Привет" },
  {
    lang: "uk_UA.UTF-8",
    name: "Українська",
    english: "Ukrainian",
    keyboard: "us,ua",
    hello: "Привіт",
  },
  { lang: "ar_SA.UTF-8", name: "العربية", english: "Arabic", keyboard: "us,ara", hello: "مرحبا" },
  { lang: "hi_IN.UTF-8", name: "हिन्दी", english: "Hindi", keyboard: "us,in", hello: "नमस्ते" },
  { lang: "ja_JP.UTF-8", name: "日本語", english: "Japanese", keyboard: "jp", hello: "こんにちは" },
  { lang: "ko_KR.UTF-8", name: "한국어", english: "Korean", keyboard: "kr", hello: "안녕하세요" },
  {
    lang: "zh_CN.UTF-8",
    name: "简体中文",
    english: "Chinese (Simplified)",
    keyboard: "us",
    hello: "你好",
  },
]

export const KEYBOARDS: { layout: string; name: string }[] = [
  { layout: "us", name: "U.S." },
  { layout: "gb", name: "British" },
  { layout: "es", name: "Spanish" },
  { layout: "latam", name: "Latin American" },
  { layout: "fr", name: "French" },
  { layout: "de", name: "German" },
  { layout: "it", name: "Italian" },
  { layout: "br", name: "Brazilian" },
  { layout: "pt", name: "Portuguese" },
  { layout: "pl", name: "Polish" },
  { layout: "tr", name: "Turkish" },
  { layout: "se", name: "Swedish" },
  { layout: "us,ru", name: "U.S. + Russian" },
  { layout: "us,ua", name: "U.S. + Ukrainian" },
  { layout: "us,ara", name: "U.S. + Arabic" },
  { layout: "us,in", name: "U.S. + Hindi" },
  { layout: "jp", name: "Japanese" },
  { layout: "kr", name: "Korean" },
  { layout: "dvorak", name: "Dvorak" },
]

/** The language that matches the current setting best (exact, then same language, then US). */
export function matchLanguage(current: string): Language {
  const exact = LANGUAGES.find((l) => l.lang === current)
  if (exact) return exact
  const prefix = current.split(/[_.]/)[0]
  return LANGUAGES.find((l) => l.lang.startsWith(`${prefix}_`)) ?? LANGUAGES[0]!
}

/** "Hello" in each language, once each, for the welcome screen. */
export function greetings(): string[] {
  return [...new Set(["Hello", ...LANGUAGES.map((l) => l.hello)])]
}

export interface Browser {
  id: string
  name: string
  /** Desktop id once installed. */
  desktopId: string
  /** Flathub app id, or null when it comes with HelixOS. */
  flathub: string | null
  color: string
  note: string
}

export const BROWSERS: Browser[] = [
  {
    id: "firefox",
    name: "Firefox",
    desktopId: "firefox",
    flathub: null,
    color: "#ff7139",
    note: "Comes with HelixOS",
  },
  {
    id: "chrome",
    name: "Google Chrome",
    desktopId: "com.google.Chrome",
    flathub: "com.google.Chrome",
    color: "#1a73e8",
    note: "From Flathub",
  },
  {
    id: "brave",
    name: "Brave",
    desktopId: "com.brave.Browser",
    flathub: "com.brave.Browser",
    color: "#fb542b",
    note: "Blocks ads and trackers",
  },
  {
    id: "zen",
    name: "Zen",
    desktopId: "app.zen_browser.zen",
    flathub: "app.zen_browser.zen",
    color: "#f76f53",
    note: "Calm, Firefox-based",
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    desktopId: "com.microsoft.Edge",
    flathub: "com.microsoft.Edge",
    color: "#0c8ce9",
    note: "From Flathub",
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    desktopId: "com.vivaldi.Vivaldi",
    flathub: "com.vivaldi.Vivaldi",
    color: "#ef3939",
    note: "Very customizable",
  },
  {
    id: "chromium",
    name: "Chromium",
    desktopId: "org.chromium.Chromium",
    flathub: "org.chromium.Chromium",
    color: "#4285f4",
    note: "Open-source Chrome",
  },
]

/** The Dock's pinned apps with the chosen browser in the old browser's place. */
export function pinBrowser(pinned: readonly string[], browser: Browser): string[] {
  const others = new Set(BROWSERS.map((b) => b.desktopId))
  const index = pinned.findIndex((id) => others.has(id))
  const rest = pinned.filter((id) => !others.has(id))
  const at = index < 0 ? Math.min(1, rest.length) : Math.min(index, rest.length)
  return [...rest.slice(0, at), browser.desktopId, ...rest.slice(at)]
}

export type AssistantChoice = "cloud" | "local" | "off"

export const LOCAL_MODELS = [
  { model: "qwen2.5:1.5b", name: "Faster", note: "Quick answers; best for this laptop" },
  { model: "qwen2.5:3b", name: "Balanced", note: "Better answers, a little slower" },
] as const

/** Anthropic API keys look like sk-ant-…; anything else is a typo. */
export function looksLikeKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())
}
