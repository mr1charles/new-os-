/**
 * Every command an app's Rust backend can answer, with argument and result types. The Rust
 * side is `services/appkit` (settings, assistant) and `services/syslib` (system); field names
 * are the Rust structs' snake_case so nothing needs mapping. Arguments are camelCase, which
 * Tauri converts to the Rust parameter names.
 *
 * An app only registers the commands it needs; calling one it lacks rejects with an error.
 */
import type { AssistantSettings } from "./assistant"

export interface WifiStatus {
  enabled: boolean
  ssid: string | null
  signal: number | null
}

export interface WifiNetwork {
  ssid: string
  signal: number
  /** "WPA2", "WPA1 WPA2", "WPA3", "WPA2 802.1X", or "" for open networks. */
  security: string
  in_use: boolean
  saved: boolean
}

export interface NetDevice {
  device: string
  kind: string
  state: string
  connection: string
  ipv4: string[]
  gateway: string
  dns: string[]
  mac: string
}

export interface BluetoothDevice {
  address: string
  name: string
  icon: string
  paired: boolean
  connected: boolean
  trusted: boolean
  battery: number | null
}

export interface Volume {
  level: number
  muted: boolean
}

export interface AudioDevice {
  id: number
  name: string
  is_default: boolean
  volume: Volume
}

export interface AudioDevices {
  outputs: AudioDevice[]
  inputs: AudioDevice[]
}

export interface Monitor {
  name: string
  description: string
  width: number
  height: number
  refresh_rate: number
  x: number
  y: number
  scale: number
  transform: number
  disabled: boolean
  focused: boolean
  physical_width: number
  physical_height: number
  /** "1920x1080@60.00Hz" */
  available_modes: string[]
}

export interface MonitorSetup {
  name: string
  /** "1920x1080@60.00" or "preferred" */
  mode: string
  x: number
  y: number
  scale: number
  transform: number
  disabled: boolean
}

export type PowerProfile = "power-saver" | "balanced" | "performance"

export interface PowerProfiles {
  active: PowerProfile | ""
  available: PowerProfile[]
}

export interface BatteryDetails {
  percent: number | null
  state: string
  health: number | null
  cycle_count: number | null
  power_watts: number | null
  on_ac: boolean
}

export interface AboutInfo {
  hostname: string
  vendor: string
  model: string
  sku: string
  firmware: string
  cpu: string
  cpu_cores: number
  memory_bytes: number
  graphics: string[]
  base_os: string
  kernel: string
  disk_total_bytes: number
  disk_free_bytes: number
}

export interface Account {
  username: string
  full_name: string
  uid: number
  home: string
  shell: string
  admin: boolean
}

export interface Fingerprints {
  available: boolean
  device: string
  enrolled: string[]
}

export type SessionKind = "installed" | "live_fullscreen" | "live_nested"

export interface SessionInfo {
  kind: SessionKind
  /** The key that plays Super's role here ("Alt" when nested in a window on the host desktop). */
  mod_key: string
}

export interface SpaceInfo {
  /** The account behind the space, e.g. "space-work". */
  account: string
  name: string
  accent: string
  default: boolean
  /** Unix seconds of the last login. */
  last_used: number
}

export interface PackageUpdate {
  name: string
  from: string
  to: string
  source: "system" | "flatpak"
}

export interface DesktopEntry {
  /** "firefox.desktop" */
  id: string
  name: string
  generic_name: string | null
  keywords: string[]
  exec: string | null
  icon: string | null
}

export interface Wallpaper {
  path: string
  name: string
}

export interface NoteMeta {
  /** Relative to the notes folder, e.g. "Work/Plan.md". */
  path: string
  /** "" for notes at the top level. */
  folder: string
  title: string
  preview: string
  /** Milliseconds since the Unix epoch. */
  modified: number
  pinned: boolean
}

export interface NoteSearchHit {
  note: NoteMeta
  snippet: string
  score: number
}

export type FileKind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "code"
  | "archive"
  | "app"
  | "other"

export interface FileEntry {
  name: string
  path: string
  kind: FileKind
  /** Bytes for files, item count for folders, null when unreadable. */
  size: number | null
  /** Milliseconds since the Unix epoch. */
  modified: number
  hidden: boolean
  symlink: boolean
}

export interface Place {
  id: string
  name: string
  path: string
}

export interface Drive {
  device: string
  name: string
  size: number
  mount_point: string | null
  removable: boolean
  filesystem: string
}

export interface TrashItem {
  id: string
  name: string
  original_path: string
  deleted: string
  kind: FileKind
  size: number | null
}

export interface FileSearch {
  words: string[]
  kinds: FileKind[]
  modified_after: number | null
  modified_before: number | null
  contents: boolean
}

/** Emitted when anything in the notes folder changes (this app, the assistant, an editor). */
export const NOTES_CHANGED_EVENT = "helixos://notes-changed"

type Json = unknown

/** A live activity in the Dynamic Island (shell: org.helixos.Island1). */
export interface IslandActivity {
  /** The app's window class, so clicking the island brings the app forward. */
  app: string
  icon: string
  title: string
  subtitle: string
  /** 0..1, or null while the amount of work is unknown. */
  progress: number | null
}

export interface AppNotification {
  app_name: string
  icon: string
  summary: string
  body: string
  /** An earlier notification's id to replace, or 0. */
  replaces: number
  urgent: boolean
}

/** Command name → [arguments, result]. */
export interface Commands {
  // Settings file (appkit::settings)
  settings_read: [Record<string, never>, Json]
  settings_update: [{ patch: Json }, Json]

  // Assistant (appkit::assistant_client, assistant_config, keyring)
  assistant_request: [{ method: string; path: string; body?: Json }, Json]
  assistant_settings_read: [Record<string, never>, AssistantSettings]
  assistant_settings_set: [{ field: keyof AssistantSettings; value: Json }, AssistantSettings]
  assistant_key_status: [Record<string, never>, boolean]
  assistant_key_store: [{ key: string }, null]
  assistant_key_clear: [Record<string, never>, null]
  assistant_restart: [Record<string, never>, null]

  // Dynamic Island and notifications (appkit::island)
  island_show: [{ id: string; activity: IslandActivity }, null]
  island_end: [{ id: string }, null]
  notify: [{ notification: AppNotification }, number]

  // Network
  wifi_status: [Record<string, never>, WifiStatus]
  wifi_set_enabled: [{ enabled: boolean }, null]
  wifi_networks: [{ rescan: boolean }, WifiNetwork[]]
  wifi_connect: [{ ssid: string; password?: string | null }, null]
  wifi_disconnect: [{ ssid: string }, null]
  wifi_forget: [{ ssid: string }, null]
  net_devices: [Record<string, never>, NetDevice[]]
  airplane_get: [Record<string, never>, boolean]
  airplane_set: [{ enabled: boolean }, null]

  // Bluetooth
  bluetooth_powered: [Record<string, never>, boolean]
  bluetooth_set_enabled: [{ enabled: boolean }, null]
  bluetooth_devices: [Record<string, never>, BluetoothDevice[]]
  bluetooth_scan: [{ seconds: number }, BluetoothDevice[]]
  bluetooth_pair: [{ address: string }, null]
  bluetooth_connect: [{ address: string }, null]
  bluetooth_disconnect: [{ address: string }, null]
  bluetooth_remove: [{ address: string }, null]

  // Sound
  audio_devices: [Record<string, never>, AudioDevices]
  audio_set_default: [{ id: number }, null]
  audio_set_volume: [{ id: number; level: number; muted: boolean }, null]

  // Displays
  brightness_get: [Record<string, never>, number]
  brightness_set: [{ level: number }, number]
  monitors: [Record<string, never>, Monitor[]]
  monitor_apply: [{ setup: MonitorSetup }, string]
  wallpapers: [Record<string, never>, Wallpaper[]]

  // Power
  power_profiles: [Record<string, never>, PowerProfiles]
  power_profile_set: [{ profile: PowerProfile }, null]
  battery_details: [Record<string, never>, BatteryDetails | null]

  // Keyboard and trackpad (Hyprland options, see syslib::hyprconf)
  hypr_options: [Record<string, never>, Record<string, string>]
  hypr_option_set: [{ key: string; value: string }, string]

  // Notes (appkit::notes)
  notes_list: [Record<string, never>, NoteMeta[]]
  notes_folders: [Record<string, never>, string[]]
  notes_search: [{ query: string }, NoteSearchHit[]]
  note_read: [{ path: string }, string]
  note_write: [{ path: string; text: string }, NoteMeta]
  note_create: [{ folder: string; text: string }, NoteMeta]
  note_delete: [{ path: string }, null]
  note_set_pinned: [{ path: string; pinned: boolean }, null]
  note_move: [{ path: string; folder: string }, NoteMeta]
  notes_folder_create: [{ name: string }, string]
  notes_folder_delete: [{ name: string }, null]

  // Terminal (appkit::pty). Sessions start with `terminal.spawn` (streaming).
  term_write: [{ id: number; data: string }, null]
  term_resize: [{ id: number; cols: number; rows: number }, null]
  term_kill: [{ id: number }, null]
  term_cwd: [{ id: number }, string]

  // Files (appkit::files)
  files_places: [Record<string, never>, Place[]]
  files_list: [{ path: string; showHidden: boolean }, FileEntry[]]
  files_info: [{ path: string }, FileEntry]
  files_drives: [Record<string, never>, Drive[]]
  files_mount: [{ device: string }, string]
  files_eject: [{ device: string; powerOff: boolean }, null]
  files_create_folder: [{ dir: string; name: string }, FileEntry]
  files_rename: [{ path: string; name: string }, FileEntry]
  files_transfer: [{ sources: string[]; dest: string; moveFiles: boolean }, string[]]
  files_trash: [{ paths: string[] }, null]
  files_trash_list: [Record<string, never>, TrashItem[]]
  files_trash_restore: [{ id: string }, string]
  files_trash_empty: [Record<string, never>, number]
  files_open: [{ path: string }, null]
  files_preview_text: [{ path: string }, string | null]
  files_document_text: [{ path: string }, string | null]
  files_pdf_thumbnail: [{ path: string }, string]
  files_search: [{ root: string; query: FileSearch; limit: number }, FileEntry[]]

  // Apps
  apps: [Record<string, never>, DesktopEntry[]]

  // System
  about: [Record<string, never>, AboutInfo]
  account: [Record<string, never>, Account]
  fingerprints: [Record<string, never>, Fingerprints]
  updates: [Record<string, never>, PackageUpdate[]]

  // Users & Spaces (helixos-spacesd; changes ask for an administrator)
  session_info: [Record<string, never>, SessionInfo]

  // Setup (first run)
  locale_get: [Record<string, never>, string]
  locale_set: [{ lang: string }, null]
  setup_install_app: [{ appId: string; defaultBrowser: boolean }, null]
  setup_default_browser: [{ desktopId: string }, null]

  spaces_list: [Record<string, never>, SpaceInfo[]]
  spaces_create: [{ name: string; password: string; accent: string }, SpaceInfo]
  spaces_delete: [{ account: string; keepHome: boolean }, null]
  spaces_rename: [{ account: string; name: string }, null]
  spaces_set_accent: [{ account: string; accent: string }, null]
  spaces_set_default: [{ account: string }, null]
  spaces_set_password: [{ account: string; password: string }, null]
  update_in_terminal: [Record<string, never>, null]
}

export type CommandName = keyof Commands
export type CommandArgs<K extends CommandName> = Commands[K][0]
export type CommandResult<K extends CommandName> = Commands[K][1]
