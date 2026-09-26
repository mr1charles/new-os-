/**
 * Checking what apps send to the island (org.newos.Island1 Show). Pure, tested in Node.
 * Anything malformed is refused rather than guessed at.
 */
import type { AppActivityPayload } from "./island-queue"

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "")

export function parseActivity(json: string): AppActivityPayload | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const title = clip(d.title, 80).trim()
  if (!title) return null
  const progress =
    typeof d.progress === "number" && Number.isFinite(d.progress)
      ? Math.min(1, Math.max(0, d.progress))
      : null
  return {
    app: clip(d.app, 64).replace(/[^\w.-]/g, ""),
    // Icon names and absolute paths only; no URLs.
    icon: /^(\/|[\w.-]+$)/.test(clip(d.icon, 256)) ? clip(d.icon, 256) : "",
    title,
    subtitle: clip(d.subtitle, 120),
    progress,
  }
}

/** Island ids per sender, so apps cannot replace or end each other's activities. */
export function scopedId(sender: string, id: string): string {
  return `app:${sender}:${id.slice(0, 64)}`
}
