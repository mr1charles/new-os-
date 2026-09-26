export interface SettingsPage {
  page: string
  title: string
  keywords: string[]
  iconName: string
}

/**
 * Pages of the Settings app (apps/settings), shared with the shell's Spotlight search.
 * `newos-settings --page <page>` opens one. `iconName` is a freedesktop symbolic icon for the
 * shell; the app draws its own icons.
 */
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
    page: "windows",
    title: "Windows & Snapping",
    keywords: [
      "tiling",
      "snap",
      "split",
      "half",
      "quarter",
      "layout",
      "arrange",
      "gaps",
      "rounded corners",
      "animations",
      "blur",
      "window buttons",
    ],
    iconName: "view-grid-symbolic",
  },
  {
    page: "customize",
    title: "Customize",
    keywords: [
      "look",
      "style",
      "theme",
      "windows look",
      "macos look",
      "presets",
      "make it look like",
      "personalize",
    ],
    iconName: "applications-graphics-symbolic",
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
