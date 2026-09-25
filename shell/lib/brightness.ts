/**
 * Screen backlight through sysfs. Reads /sys/class/backlight/<device>/actual_brightness,
 * watches it for changes (the kernel emits inotify events via sysfs_notify), and writes
 * through `brightnessctl`, which works without root via the logind session.
 */
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import { createState } from "ags"
import { execAsync } from "ags/process"

const BASE = "/sys/class/backlight"

function findDevice(): string | null {
  if (!GLib.file_test(BASE, GLib.FileTest.IS_DIR)) return null
  const names: string[] = []
  const dir = GLib.Dir.open(BASE, 0)
  for (let name = dir.read_name(); name !== null; name = dir.read_name()) names.push(name)
  dir.close()
  const preferred = ["intel_backlight", "amdgpu_bl0", "amdgpu_bl1", "acpi_video0"]
  return preferred.find((n) => names.includes(n)) ?? names.sort()[0] ?? null
}

function readInt(path: string): number {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    return ok ? Number.parseInt(new TextDecoder().decode(bytes).trim(), 10) || 0 : 0
  } catch {
    return 0
  }
}

const device = findDevice()
const devicePath = device ? `${BASE}/${device}` : null
const max = devicePath ? readInt(`${devicePath}/max_brightness`) : 0

export const hasBacklight = devicePath !== null && max > 0

function current(): number {
  if (!hasBacklight || !devicePath) return 1
  return Math.max(0, Math.min(1, readInt(`${devicePath}/actual_brightness`) / max))
}

const [brightness, setBrightnessState] = createState(current())
export { brightness }

export const brightnessMonitor = hasBacklight
  ? Gio.File.new_for_path(`${devicePath}/actual_brightness`).monitor_file(
      Gio.FileMonitorFlags.NONE,
      null,
    )
  : null
brightnessMonitor?.connect("changed", () => setBrightnessState(current()))

/** Set brightness as a fraction. Never goes fully dark so the screen stays usable. */
export async function setBrightness(fraction: number) {
  if (!hasBacklight) return
  const percent = Math.round(Math.max(0.01, Math.min(1, fraction)) * 100)
  await execAsync(["brightnessctl", "--quiet", "set", `${percent}%`]).catch((e) =>
    console.warn(`newos: brightnessctl failed: ${e}`),
  )
  setBrightnessState(current())
}

export function stepBrightness(delta: number) {
  return setBrightness(brightness.peek() + delta)
}
