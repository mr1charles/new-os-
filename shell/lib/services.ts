/**
 * Shared Astal service singletons. Each one can be missing at runtime (no battery on a
 * desktop, no Bluetooth adapter, running outside Hyprland while developing), so every export
 * is nullable and widgets degrade instead of crashing the shell.
 */
import AstalHyprland from "gi://AstalHyprland"
import AstalBattery from "gi://AstalBattery"
import AstalNetwork from "gi://AstalNetwork"
import AstalWp from "gi://AstalWp"
import AstalNotifd from "gi://AstalNotifd"
import AstalMpris from "gi://AstalMpris"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalTray from "gi://AstalTray"
import AstalPowerProfiles from "gi://AstalPowerProfiles"

function optional<T>(name: string, get: () => T | null | undefined): T | null {
  try {
    return get() ?? null
  } catch (error) {
    console.warn(`helixos: ${name} is unavailable: ${error}`)
    return null
  }
}

export const hyprland = optional("Hyprland IPC", () => AstalHyprland.get_default())
export const battery = optional("UPower", () => {
  const device = AstalBattery.get_default()
  return device.isPresent ? device : null
})
export const network = optional("NetworkManager", () => AstalNetwork.get_default())
export const wp = optional("WirePlumber", () => AstalWp.get_default())
export const speaker = wp?.defaultSpeaker ?? null
export const microphone = wp?.defaultMicrophone ?? null
/** Owning org.freedesktop.Notifications makes the shell the notification server. */
export const notifd = optional("notification server", () => AstalNotifd.get_default())
export const mpris = optional("MPRIS", () => AstalMpris.get_default())
export const bluetooth = optional("BlueZ", () => AstalBluetooth.get_default())
export const tray = optional("system tray", () => AstalTray.get_default())
export const powerProfiles = optional("power-profiles-daemon", () =>
  AstalPowerProfiles.get_default(),
)

export {
  AstalHyprland,
  AstalBattery,
  AstalNetwork,
  AstalWp,
  AstalNotifd,
  AstalMpris,
  AstalBluetooth,
}
