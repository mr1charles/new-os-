import { speaker } from "./services"

export function volumeIcon(volume: number, muted: boolean): string {
  if (muted || volume <= 0.001) return "audio-volume-muted-symbolic"
  if (volume < 0.34) return "audio-volume-low-symbolic"
  if (volume < 0.67) return "audio-volume-medium-symbolic"
  return "audio-volume-high-symbolic"
}

export function setVolume(value: number) {
  if (!speaker) return
  speaker.volume = Math.max(0, Math.min(1, value))
  if (speaker.mute && value > 0) speaker.mute = false
}

export function stepVolume(delta: number) {
  if (!speaker) return
  // Snap to 5% steps like macOS so repeated presses land on round numbers.
  const next = Math.round((speaker.volume + delta) * 20) / 20
  setVolume(next)
}

export function toggleMute() {
  if (speaker) speaker.mute = !speaker.mute
}
