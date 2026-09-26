/**
 * Type declarations for the Astal libraries the shell uses.
 *
 * On a device with Astal installed, `pnpm --filter @newos/shell types` runs `ags types`, which
 * generates complete declarations from the installed GObject introspection data into
 * `shell/@girs` (git-ignored). CI has no Astal install, so these hand-written declarations
 * cover the subset of the API the shell calls. They were written from the Vala/C sources of
 * github.com/Aylur/astal (lib/*), keeping GObject property names in camelCase and snake_case
 * the same way ts-for-gir does.
 *
 * Keep this file in sync when the shell starts using a new Astal API.
 */

// ---------------------------------------------------------------------------------------------
// Astal (GTK4 widgets and layer-shell window)
// ---------------------------------------------------------------------------------------------
declare module "gi://Astal?version=4.0" {
  import type Gtk from "gi://Gtk?version=4.0"
  import type Gdk from "gi://Gdk?version=4.0"
  import type GObject from "gi://GObject?version=2.0"

  namespace Astal {
    enum WindowAnchor {
      NONE,
      TOP,
      RIGHT,
      LEFT,
      BOTTOM,
    }
    enum Exclusivity {
      NORMAL,
      EXCLUSIVE,
      IGNORE,
    }
    enum Layer {
      BACKGROUND,
      BOTTOM,
      TOP,
      OVERLAY,
    }
    enum Keymode {
      NONE,
      EXCLUSIVE,
      ON_DEMAND,
    }

    namespace Window {
      interface SignalSignatures extends Gtk.Window.SignalSignatures {
        "notify::namespace": (pspec: GObject.ParamSpec) => void
        "notify::anchor": (pspec: GObject.ParamSpec) => void
        "notify::layer": (pspec: GObject.ParamSpec) => void
        "notify::keymode": (pspec: GObject.ParamSpec) => void
        "notify::gdkmonitor": (pspec: GObject.ParamSpec) => void
      }
      interface ConstructorProps extends Gtk.Window.ConstructorProps {
        namespace: string
        anchor: WindowAnchor
        exclusivity: Exclusivity
        layer: Layer
        keymode: Keymode
        gdkmonitor: Gdk.Monitor
        monitor: number
        margin: number
        margin_top: number
        marginTop: number
        margin_bottom: number
        marginBottom: number
        margin_left: number
        marginLeft: number
        margin_right: number
        marginRight: number
      }
    }
    class Window extends Gtk.Window {
      $signals: Window.SignalSignatures
      constructor(properties?: Partial<Window.ConstructorProps>, ...args: any[])
      namespace: string
      anchor: WindowAnchor
      exclusivity: Exclusivity
      layer: Layer
      keymode: Keymode
      gdkmonitor: Gdk.Monitor
      monitor: number
      get_current_monitor(): Gdk.Monitor
    }

    namespace Slider {
      interface SignalSignatures extends Gtk.Scale.SignalSignatures {
        "notify::value": (pspec: GObject.ParamSpec) => void
      }
      interface ConstructorProps extends Gtk.Scale.ConstructorProps {
        value: number
        min: number
        max: number
        step: number
        page: number
      }
    }
    class Slider extends Gtk.Scale {
      $signals: Slider.SignalSignatures
      constructor(properties?: Partial<Slider.ConstructorProps>, ...args: any[])
      value: number
      min: number
      max: number
      step: number
      page: number
    }
  }
  export default Astal
}

// ---------------------------------------------------------------------------------------------
// AstalHyprland
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalHyprland" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalHyprland {
    function get_default(): Hyprland | null

    enum Fullscreen {
      CURRENT,
      NONE,
      MAXIMIZED,
      FULLSCREEN,
    }

    namespace Hyprland {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        event: (event: string, args: string) => void
        minimize: (client: Client, minimize: boolean) => void
        floating: (client: Client, floating: boolean) => void
        urgent: (client: Client) => void
        "client-moved": (client: Client, ws: Workspace) => void
        "client-added": (client: Client) => void
        "client-removed": (address: string) => void
        "workspace-added": (workspace: Workspace) => void
        "workspace-removed": (id: number) => void
        "monitor-added": (monitor: Monitor) => void
        "monitor-removed": (id: number) => void
        "config-reloaded": () => void
        "notify::clients": (pspec: GObject.ParamSpec) => void
        "notify::workspaces": (pspec: GObject.ParamSpec) => void
        "notify::focused-client": (pspec: GObject.ParamSpec) => void
        "notify::focused-workspace": (pspec: GObject.ParamSpec) => void
      }
    }
    class Hyprland extends GObject.Object {
      $signals: Hyprland.SignalSignatures
      static get_default(): Hyprland | null
      readonly monitors: Monitor[]
      readonly workspaces: Workspace[]
      readonly clients: Client[]
      readonly focused_workspace: Workspace
      readonly focusedWorkspace: Workspace
      readonly focused_monitor: Monitor
      readonly focusedMonitor: Monitor
      readonly focused_client: Client | null
      readonly focusedClient: Client | null
      readonly binds: Bind[]
      get_monitor(id: number): Monitor
      get_workspace(id: number): Workspace
      get_client(address: string): Client | null
      message(message: string): string
      message_async(message: string): Promise<string>
      dispatch(dispatcher: string, args: string): void
      connect<K extends keyof Hyprland.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, Hyprland.SignalSignatures[K]>,
      ): number
    }

    namespace Client {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        removed: () => void
        "moved-to": (workspace: Workspace) => void
        "notify::title": (pspec: GObject.ParamSpec) => void
      }
    }
    class Client extends GObject.Object {
      $signals: Client.SignalSignatures
      readonly address: string
      readonly mapped: boolean
      readonly hidden: boolean
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly workspace: Workspace
      readonly floating: boolean
      readonly monitor: Monitor
      readonly class: string
      readonly title: string
      readonly initial_class: string
      readonly initialClass: string
      readonly initial_title: string
      readonly initialTitle: string
      readonly pid: number
      readonly xwayland: boolean
      readonly pinned: boolean
      readonly fullscreen: Fullscreen
      readonly focus_history_id: number
      readonly focusHistoryId: number
      kill(): void
      focus(): void
      move_to(ws: Workspace): void
      toggle_floating(): void
    }

    class Bind extends GObject.Object {
      readonly locked: boolean
      readonly mouse: boolean
      readonly release: boolean
      readonly repeat: boolean
      readonly non_consuming: boolean
      readonly modmask: number
      readonly submap: string
      readonly key: string
      readonly keycode: number
      readonly description: string
      readonly dispatcher: string
      readonly arg: string
    }

    class Workspace extends GObject.Object {
      readonly id: number
      readonly name: string
      readonly monitor: Monitor
      readonly clients: Client[]
      readonly has_fullscreen: boolean
      readonly hasFullscreen: boolean
      readonly last_client: Client
      readonly lastClient: Client
      focus(): void
    }

    class Monitor extends GObject.Object {
      readonly id: number
      readonly name: string
      readonly description: string
      readonly model: string
      readonly width: number
      readonly height: number
      readonly scale: number
      readonly focused: boolean
      readonly active_workspace: Workspace
      readonly activeWorkspace: Workspace
      readonly available_modes: string[]
      readonly availableModes: string[]
      focus(): void
    }
  }
  export default AstalHyprland
}

// ---------------------------------------------------------------------------------------------
// AstalBattery (UPower)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalBattery" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalBattery {
    function get_default(): Device

    class UPower extends GObject.Object {
      readonly devices: Device[]
      readonly display_device: Device
      readonly displayDevice: Device
      readonly on_battery: boolean
      readonly onBattery: boolean
      readonly lid_is_closed: boolean
      readonly lidIsClosed: boolean
    }

    enum State {
      UNKNOWN,
      CHARGING,
      DISCHARGING,
      EMPTY,
      FULLY_CHARGED,
      PENDING_CHARGE,
      PENDING_DISCHARGE,
    }
    enum WarningLevel {
      UNKNOWN,
      NONE,
      DISCHARGING,
      LOW,
      CRITICIAL,
      ACTION,
    }

    namespace Device {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        "notify::percentage": (pspec: GObject.ParamSpec) => void
        "notify::charging": (pspec: GObject.ParamSpec) => void
        "notify::state": (pspec: GObject.ParamSpec) => void
      }
    }
    class Device extends GObject.Object {
      $signals: Device.SignalSignatures
      static get_default(): Device
      readonly vendor: string
      readonly model: string
      readonly online: boolean
      readonly energy_rate: number
      readonly energyRate: number
      readonly time_to_empty: number
      readonly timeToEmpty: number
      readonly time_to_full: number
      readonly timeToFull: number
      /** 0.0 - 1.0 */
      readonly percentage: number
      readonly temperature: number
      readonly is_present: boolean
      readonly isPresent: boolean
      readonly state: State
      readonly capacity: number
      readonly warning_level: WarningLevel
      readonly warningLevel: WarningLevel
      readonly icon_name: string
      readonly iconName: string
      readonly charging: boolean
      readonly is_battery: boolean
      readonly isBattery: boolean
      readonly battery_icon_name: string
      readonly batteryIconName: string
      readonly charge_cycles: number
      readonly chargeCycles: number
      connect<K extends keyof Device.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, Device.SignalSignatures[K]>,
      ): number
    }
  }
  export default AstalBattery
}

// ---------------------------------------------------------------------------------------------
// AstalNetwork (NetworkManager)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalNetwork" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalNetwork {
    function get_default(): Network

    enum Primary {
      UNKNOWN,
      WIRED,
      WIFI,
    }
    enum State {
      UNKNOWN,
      ASLEEP,
      DISCONNECTED,
      DISCONNECTING,
      CONNECTING,
      CONNECTED_LOCAL,
      CONNECTED_SITE,
      CONNECTED_GLOBAL,
    }
    enum Internet {
      CONNECTED,
      CONNECTING,
      DISCONNECTED,
    }

    class Network extends GObject.Object {
      static get_default(): Network
      readonly wifi: Wifi | null
      readonly wired: Wired | null
      readonly primary: Primary
      readonly state: State
    }

    namespace Wifi {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        "access-point-added": (ap: AccessPoint) => void
        "access-point-removed": (ap: AccessPoint) => void
        "notify::enabled": (pspec: GObject.ParamSpec) => void
        "notify::ssid": (pspec: GObject.ParamSpec) => void
      }
    }
    class Wifi extends GObject.Object {
      $signals: Wifi.SignalSignatures
      readonly access_points: AccessPoint[]
      readonly accessPoints: AccessPoint[]
      readonly active_access_point: AccessPoint | null
      readonly activeAccessPoint: AccessPoint | null
      enabled: boolean
      readonly internet: Internet
      readonly ssid: string
      readonly strength: number
      readonly icon_name: string
      readonly iconName: string
      readonly scanning: boolean
      scan(): void
      deactivate_connection(): Promise<void>
    }

    class Wired extends GObject.Object {
      readonly speed: number
      readonly internet: Internet
      readonly icon_name: string
      readonly iconName: string
    }

    class AccessPoint extends GObject.Object {
      readonly bssid: string
      readonly frequency: number
      readonly strength: number
      readonly icon_name: string
      readonly iconName: string
      readonly ssid: string | null
      readonly requires_password: boolean
      readonly requiresPassword: boolean
      get_path(): string
      /** Saved NetworkManager connections for this access point (NM.RemoteConnection[]). */
      get_connections(): GObject.Object[]
      activate(password?: string | null): Promise<void>
    }
  }
  export default AstalNetwork
}

// ---------------------------------------------------------------------------------------------
// AstalWp (WirePlumber / PipeWire audio)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalWp" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalWp {
    function get_default(): Wp | null

    namespace Node {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        "notify::volume": (pspec: GObject.ParamSpec) => void
        "notify::mute": (pspec: GObject.ParamSpec) => void
      }
    }
    class Node extends GObject.Object {
      $signals: Node.SignalSignatures
      volume: number
      mute: boolean
      readonly id: number
      readonly description: string
      readonly name: string
      readonly icon: string
      readonly volume_icon: string
      readonly volumeIcon: string
      set_volume(volume: number): void
      set_mute(mute: boolean): void
      connect<K extends keyof Node.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, Node.SignalSignatures[K]>,
      ): number
    }

    class Endpoint extends Node {
      is_default: boolean
      isDefault: boolean
    }

    class Device extends GObject.Object {
      readonly id: number
      readonly description: string
      readonly icon: string
    }

    class Stream extends Node {}

    class Audio extends GObject.Object {
      readonly streams: Stream[]
      readonly recorders: Stream[]
      readonly devices: Device[]
      readonly default_speaker: Endpoint
      readonly defaultSpeaker: Endpoint
      readonly default_microphone: Endpoint
      readonly defaultMicrophone: Endpoint
      readonly speakers: Endpoint[]
      readonly microphones: Endpoint[]
    }

    class Video extends GObject.Object {
      readonly streams: Stream[]
      readonly recorders: Stream[]
      readonly sinks: Endpoint[]
      readonly sources: Endpoint[]
      readonly devices: Device[]
    }

    class Wp extends GObject.Object {
      static get_default(): Wp | null
      readonly audio: Audio
      readonly video: Video
      readonly devices: Device[]
      readonly nodes: Node[]
      readonly default_speaker: Endpoint
      readonly defaultSpeaker: Endpoint
      readonly default_microphone: Endpoint
      readonly defaultMicrophone: Endpoint
    }
  }
  export default AstalWp
}

// ---------------------------------------------------------------------------------------------
// AstalNotifd (notification daemon)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalNotifd" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalNotifd {
    function get_default(): Notifd

    enum Urgency {
      LOW,
      NORMAL,
      CRITICAL,
    }
    enum ClosedReason {
      EXPIRED,
      DISMISSED_BY_USER,
      CLOSED,
      UNDEFINED,
    }

    namespace Notifd {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        notified: (id: number, replaced: boolean) => void
        resolved: (id: number, reason: ClosedReason) => void
        "notify::notifications": (pspec: GObject.ParamSpec) => void
        "notify::dont-disturb": (pspec: GObject.ParamSpec) => void
      }
    }
    class Notifd extends GObject.Object {
      $signals: Notifd.SignalSignatures
      static get_default(): Notifd
      ignore_timeout: boolean
      ignoreTimeout: boolean
      dont_disturb: boolean
      dontDisturb: boolean
      default_timeout: number
      defaultTimeout: number
      readonly notifications: Notification[]
      get_notification(id: number): Notification | null
      connect<K extends keyof Notifd.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, Notifd.SignalSignatures[K]>,
      ): number
    }

    class Action extends GObject.Object {
      readonly id: string
      readonly label: string
      invoke(): void
    }

    class Notification extends GObject.Object {
      readonly time: number
      readonly id: number
      readonly app_name: string | null
      readonly appName: string | null
      readonly app_icon: string | null
      readonly appIcon: string | null
      readonly summary: string
      readonly body: string
      readonly expire_timeout: number
      readonly expireTimeout: number
      readonly actions: Action[]
      readonly image: string
      readonly category: string
      readonly desktop_entry: string
      readonly desktopEntry: string
      readonly resident: boolean
      readonly transient: boolean
      readonly urgency: Urgency
      dismiss(): void
      expire(): void
      invoke(action_id: string): void
    }
  }
  export default AstalNotifd
}

// ---------------------------------------------------------------------------------------------
// AstalMpris (media players)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalMpris" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalMpris {
    function get_default(): Mpris

    enum PlaybackStatus {
      PLAYING,
      PAUSED,
      STOPPED,
    }

    namespace Mpris {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        "player-added": (player: Player) => void
        "player-closed": (player: Player) => void
        "notify::players": (pspec: GObject.ParamSpec) => void
      }
    }
    class Mpris extends GObject.Object {
      $signals: Mpris.SignalSignatures
      static get_default(): Mpris
      readonly players: Player[]
      connect<K extends keyof Mpris.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, Mpris.SignalSignatures[K]>,
      ): number
    }

    namespace Player {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        "notify::playback-status": (pspec: GObject.ParamSpec) => void
        "notify::title": (pspec: GObject.ParamSpec) => void
        "notify::artist": (pspec: GObject.ParamSpec) => void
        "notify::cover-art": (pspec: GObject.ParamSpec) => void
        "notify::position": (pspec: GObject.ParamSpec) => void
      }
    }
    class Player extends GObject.Object {
      $signals: Player.SignalSignatures
      readonly bus_name: string
      readonly busName: string
      readonly available: boolean
      readonly identity: string
      readonly entry: string
      readonly playback_status: PlaybackStatus
      readonly playbackStatus: PlaybackStatus
      readonly can_go_next: boolean
      readonly canGoNext: boolean
      readonly can_go_previous: boolean
      readonly canGoPrevious: boolean
      readonly can_control: boolean
      readonly canControl: boolean
      readonly length: number
      position: number
      volume: number
      readonly art_url: string
      readonly artUrl: string
      readonly cover_art: string
      readonly coverArt: string
      readonly title: string
      readonly artist: string
      readonly album: string
      readonly comments: string
      readonly supported_uri_schemes: string[]
      readonly supportedUriSchemes: string[]
      readonly supported_mime_types: string[]
      readonly supportedMimeTypes: string[]
      raise(): void
      next(): void
      previous(): void
      play(): void
      pause(): void
      play_pause(): void
      stop(): void
      connect<K extends keyof Player.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, Player.SignalSignatures[K]>,
      ): number
    }
  }
  export default AstalMpris
}

// ---------------------------------------------------------------------------------------------
// AstalApps (desktop entries + fuzzy search)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalApps" {
  import type GObject from "gi://GObject?version=2.0"
  import type Gio from "gi://Gio?version=2.0"

  namespace AstalApps {
    namespace Apps {
      interface ConstructorProps extends GObject.Object.ConstructorProps {
        show_hidden: boolean
        showHidden: boolean
        min_score: number
        minScore: number
        name_multiplier: number
        nameMultiplier: number
        entry_multiplier: number
        entryMultiplier: number
        executable_multiplier: number
        executableMultiplier: number
        description_multiplier: number
        descriptionMultiplier: number
        keywords_multiplier: number
        keywordsMultiplier: number
        categories_multiplier: number
        categoriesMultiplier: number
      }
    }
    class Apps extends GObject.Object {
      constructor(properties?: Partial<Apps.ConstructorProps>, ...args: any[])
      readonly list: Application[]
      fuzzy_query(search?: string | null): Application[]
      exact_query(search?: string | null): Application[]
      reload(): void
    }

    class Application extends GObject.Object {
      readonly app: Gio.DesktopAppInfo
      frequency: number
      readonly name: string
      /** Desktop file id, for example "firefox.desktop". */
      readonly entry: string
      readonly description: string
      readonly wm_class: string
      readonly wmClass: string
      readonly executable: string
      readonly icon_name: string
      readonly iconName: string
      readonly keywords: string[]
      readonly categories: string[]
      get_key(key: string): string
      launch(): boolean
    }
  }
  export default AstalApps
}

// ---------------------------------------------------------------------------------------------
// AstalBluetooth (BlueZ)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalBluetooth" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalBluetooth {
    function get_default(): Bluetooth

    class Bluetooth extends GObject.Object {
      static get_default(): Bluetooth
      readonly is_powered: boolean
      readonly isPowered: boolean
      readonly is_connected: boolean
      readonly isConnected: boolean
      readonly adapter: Adapter | null
      readonly adapters: Adapter[]
      readonly devices: Device[]
      toggle(): void
    }

    class Adapter extends GObject.Object {
      readonly uuids: string[]
      readonly name: string
      readonly address: string
      readonly discovering: boolean
      powered: boolean
      alias: string
      start_discovery(): void
      stop_discovery(): void
    }

    class Device extends GObject.Object {
      readonly uuids: string[]
      readonly connected: boolean
      readonly paired: boolean
      readonly address: string
      readonly icon: string
      readonly name: string
      readonly connecting: boolean
      trusted: boolean
      readonly battery_percentage: number
      readonly batteryPercentage: number
      alias: string
      connect_device(): Promise<void>
      disconnect_device(): Promise<void>
      pair(): void
    }
  }
  export default AstalBluetooth
}

// ---------------------------------------------------------------------------------------------
// AstalTray (StatusNotifierItem tray)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalTray" {
  import type GObject from "gi://GObject?version=2.0"
  import type Gio from "gi://Gio?version=2.0"

  namespace AstalTray {
    function get_default(): Tray

    class Tray extends GObject.Object {
      static get_default(): Tray
      readonly items: TrayItem[]
      get_item(item_id: string): TrayItem
    }

    namespace TrayItem {
      interface SignalSignatures extends GObject.Object.SignalSignatures {
        changed: () => void
        ready: () => void
        "notify::action-group": (pspec: GObject.ParamSpec) => void
        "notify::menu-model": (pspec: GObject.ParamSpec) => void
        "notify::gicon": (pspec: GObject.ParamSpec) => void
      }
    }
    class TrayItem extends GObject.Object {
      $signals: TrayItem.SignalSignatures
      connect<K extends keyof TrayItem.SignalSignatures>(
        signal: K,
        callback: GObject.SignalCallback<this, TrayItem.SignalSignatures[K]>,
      ): number
      readonly title: string
      readonly tooltip_markup: string
      readonly tooltipMarkup: string
      readonly id: string
      readonly item_id: string
      readonly itemId: string
      readonly gicon: Gio.Icon
      readonly menu_model: Gio.MenuModel | null
      readonly menuModel: Gio.MenuModel | null
      readonly action_group: Gio.ActionGroup | null
      readonly actionGroup: Gio.ActionGroup | null
      about_to_show(): void
      activate(x: number, y: number): void
      secondary_activate(x: number, y: number): void
    }
  }
  export default AstalTray
}

// ---------------------------------------------------------------------------------------------
// AstalPowerProfiles (power-profiles-daemon)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalPowerProfiles" {
  import type GObject from "gi://GObject?version=2.0"

  namespace AstalPowerProfiles {
    function get_default(): PowerProfiles

    interface Profile {
      profile: string
      cpu_driver: string
      platform_driver: string
      driver: string
    }

    class PowerProfiles extends GObject.Object {
      static get_default(): PowerProfiles
      active_profile: string
      activeProfile: string
      readonly icon_name: string
      readonly iconName: string
      readonly profiles: Profile[]
      readonly actions: string[]
    }
  }
  export default AstalPowerProfiles
}

// ---------------------------------------------------------------------------------------------
// AstalAuth (PAM from the shell: the lock screen checks the space's own password)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalAuth" {
  import type Gio from "gi://Gio?version=2.0"

  namespace AstalAuth {
    class Pam {
      /** Starts PAM for the current user with `password`; returns false if it could not start. */
      static authenticate(
        password: string,
        callback: (source: null, result: Gio.AsyncResult) => void,
      ): boolean
      /** 0 on success; throws a GLib.Error on failure. */
      static authenticate_finish(result: Gio.AsyncResult): number
    }
  }
  export default AstalAuth
}

// ---------------------------------------------------------------------------------------------
// AstalGreet (greetd IPC for the login screen)
// ---------------------------------------------------------------------------------------------
declare module "gi://AstalGreet" {
  import type Gio from "gi://Gio?version=2.0"

  namespace AstalGreet {
    /** Authenticate `username` with greetd and start `cmd` as their session. */
    function login(
      username: string,
      password: string,
      cmd: string,
      callback: (source: null, result: Gio.AsyncResult) => void,
    ): void
    /** Throws a GLib.Error when greetd refused the login. */
    function login_finish(result: Gio.AsyncResult): void
  }
  export default AstalGreet
}

// ---------------------------------------------------------------------------------------------
// Gtk4SessionLock (ext-session-lock-v1 from gtk4-layer-shell: the lock screen)
// ---------------------------------------------------------------------------------------------
declare module "gi://Gtk4SessionLock?version=1.0" {
  import type Gtk from "gi://Gtk?version=4.0"
  import type Gdk from "gi://Gdk?version=4.0"
  import type GObject from "gi://GObject?version=2.0"

  namespace Gtk4SessionLock {
    function is_supported(): boolean

    class Instance extends GObject.Object {
      static ["new"](): Instance
      /** Ask the compositor to lock. "locked" or "failed" follows. */
      lock(): boolean
      unlock(): void
      is_locked(): boolean
      assign_window_to_monitor(window: Gtk.Window, monitor: Gdk.Monitor): void
      connect(signal: "locked" | "failed" | "unlocked", callback: (self: Instance) => void): number
      connect(signal: "monitor", callback: (self: Instance, monitor: Gdk.Monitor) => void): number
      connect(signal: string, callback: (...args: unknown[]) => unknown): number
    }
  }
  export default Gtk4SessionLock
}
