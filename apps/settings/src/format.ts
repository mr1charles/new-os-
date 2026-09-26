/** Formatting for values shown in Settings. Pure, so it is unit tested. */

/** 16387645440 -> "16 GB" (binary units, rounded like macOS About). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB"
  const units = ["bytes", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
}

/** "right-middle-finger" -> "Right middle finger" */
export function fingerName(id: string): string {
  const text = id.replace(/-/g, " ").trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz" -> "Intel Core i3-1125G4 @ 2.00GHz" */
export function cleanCpuName(cpu: string): string {
  return cpu
    .replace(/\((R|TM|tm|r)\)/g, "")
    .replace(/^\d+(st|nd|rd|th) Gen\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** "Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4]" -> "Intel UHD Graphics G4" */
export function cleanGpuName(gpu: string): string {
  const bracket = /\[([^\]]+)\]/.exec(gpu)
  const vendor = /^(Intel|AMD|Advanced Micro Devices|NVIDIA)/i.exec(gpu)?.[1]
  const vendorName = vendor && /advanced/i.test(vendor) ? "AMD" : vendor
  if (bracket) return [vendorName, bracket[1]].filter(Boolean).join(" ")
  return gpu.replace(/ Corporation/, "")
}

/** Wi-Fi signal (0-100) to 1-3 bars. */
export function signalBars(signal: number): 1 | 2 | 3 {
  if (signal >= 67) return 3
  if (signal >= 34) return 2
  return 1
}

/** 802.1X ("enterprise") networks need a username and certificates, not just a password. */
export function isEnterprise(security: string): boolean {
  return /802\.1X|EAP/i.test(security)
}

/** "1920x1080@60.00Hz" -> { width, height, refresh, value: "1920x1080@60.00" } */
export function parseMode(mode: string) {
  const match = /^(\d+)x(\d+)@([\d.]+)/.exec(mode)
  if (!match) return null
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    refresh: Number(match[3]),
    value: `${match[1]}x${match[2]}@${match[3]}`,
  }
}

/** Resolution the desktop looks like at a scale: "Looks like 1536 × 864". */
export function looksLike(width: number, height: number, scale: number): string {
  return `${Math.round(width / scale)} × ${Math.round(height / scale)}`
}

/** Installed memory from MemTotal, which excludes firmware-reserved RAM: 15.3 GiB -> "16 GB". */
export function formatMemory(bytes: number): string {
  return `${Math.max(1, Math.ceil(bytes / 1024 ** 3))} GB`
}
