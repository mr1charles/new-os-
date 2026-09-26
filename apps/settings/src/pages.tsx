/**
 * The page registry. Ids and titles come from `@helixos/sdk/settings-pages` (shared with the
 * shell's Spotlight search); this file adds the icon, the sidebar section, and the component.
 */
import { SETTINGS_PAGES, type SettingsPage } from "@helixos/sdk/settings-pages"
import { IconTile } from "@helixos/ui"
import {
  Battery,
  Bell,
  Bluetooth,
  Hand,
  Image,
  Info,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  LayoutPanelTop,
  Monitor,
  Moon,
  Network,
  Palette,
  RefreshCw,
  Sparkles,
  SquareMousePointer,
  Users,
  Volume2,
  Wand2,
  Wifi,
  type LucideIcon,
} from "lucide-react"
import type { ComponentType } from "react"
import { AboutPage } from "./pages/About"
import { AppearancePage } from "./pages/Appearance"
import { AssistantPage } from "./pages/Assistant"
import { BatteryPage } from "./pages/Battery"
import { BluetoothPage } from "./pages/Bluetooth"
import { DisplaysPage } from "./pages/Displays"
import { CustomizePage } from "./pages/Customize"
import { DockPage } from "./pages/Dock"
import { FocusPage } from "./pages/Focus"
import { KeyboardPage } from "./pages/Keyboard"
import { NetworkPage } from "./pages/Network"
import { NotificationsPage } from "./pages/Notifications"
import { PrivacyPage } from "./pages/Privacy"
import { SoundPage } from "./pages/Sound"
import { SpacesPage } from "./pages/Spaces"
import { TrackpadPage } from "./pages/Trackpad"
import { UpdatePage } from "./pages/Update"
import { WallpaperPage } from "./pages/Wallpaper"
import { WifiPage } from "./pages/Wifi"
import { WidgetsPage } from "./pages/Widgets"
import { WindowsPage } from "./pages/Windows"

interface PageView {
  icon: LucideIcon
  color: string
  component: ComponentType
}

/** Sidebar sections, in order, like System Settings. */
export const SECTIONS: string[][] = [
  ["wifi", "bluetooth", "network"],
  ["notifications", "focus", "sound"],
  ["customize", "appearance", "wallpaper", "widgets", "dock", "windows", "displays", "battery"],
  ["assistant", "privacy", "spaces"],
  ["keyboard", "trackpad"],
  ["update", "about"],
]

const VIEWS: Record<string, PageView> = {
  wifi: { icon: Wifi, color: "#0a84ff", component: WifiPage },
  bluetooth: { icon: Bluetooth, color: "#0a84ff", component: BluetoothPage },
  network: { icon: Network, color: "#0a84ff", component: NetworkPage },
  notifications: { icon: Bell, color: "#ff3b30", component: NotificationsPage },
  focus: { icon: Moon, color: "#5e5ce6", component: FocusPage },
  sound: { icon: Volume2, color: "#ff2d55", component: SoundPage },
  appearance: { icon: Palette, color: "#48484a", component: AppearancePage },
  wallpaper: { icon: Image, color: "#32ade6", component: WallpaperPage },
  dock: { icon: LayoutPanelTop, color: "#48484a", component: DockPage },
  widgets: { icon: LayoutDashboard, color: "#ff9f0a", component: WidgetsPage },
  windows: { icon: LayoutGrid, color: "#0a84ff", component: WindowsPage },
  customize: { icon: Wand2, color: "#af52de", component: CustomizePage },
  displays: { icon: Monitor, color: "#0a84ff", component: DisplaysPage },
  battery: { icon: Battery, color: "#34c759", component: BatteryPage },
  assistant: { icon: Sparkles, color: "#af52de", component: AssistantPage },
  privacy: { icon: Hand, color: "#0a84ff", component: PrivacyPage },
  spaces: { icon: Users, color: "#0a84ff", component: SpacesPage },
  keyboard: { icon: Keyboard, color: "#8e8e93", component: KeyboardPage },
  trackpad: { icon: SquareMousePointer, color: "#8e8e93", component: TrackpadPage },
  update: { icon: RefreshCw, color: "#8e8e93", component: UpdatePage },
  about: { icon: Info, color: "#8e8e93", component: AboutPage },
}

export interface Page extends SettingsPage, PageView {}

export const PAGES: Page[] = SETTINGS_PAGES.filter((p) => p.page in VIEWS).map((p) => ({
  ...p,
  ...VIEWS[p.page]!,
}))

export const DEFAULT_PAGE = "wifi"

export function findPage(id: string | null | undefined): Page | undefined {
  return PAGES.find((p) => p.page === id)
}

/** Pages whose title or keywords contain every word of the query. */
export function searchPages(query: string): Page[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return PAGES
  return PAGES.filter((p) => {
    const haystack = [p.title, ...p.keywords].join(" ").toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

export function PageIcon({ page, size = 22 }: { page: Page; size?: number }) {
  const Icon = page.icon
  return (
    <IconTile color={page.color} size={size}>
      <Icon strokeWidth={2.2} />
    </IconTile>
  )
}
