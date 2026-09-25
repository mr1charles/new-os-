/**
 * Countdown timers shown as live activities in the Dynamic Island. The assistant's
 * set_timer tool starts them through assistantd's event stream; the island can cancel them.
 */
import GLib from "gi://GLib?version=2.0"
import { island } from "./island"
import { notify, playSound } from "./system"

interface RunningTimer {
  id: string
  label: string
  endsAt: number
  durationMs: number
  source: number
}

const running = new Map<string, RunningTimer>()

function activityId(id: string) {
  return `timer:${id}`
}

function finish(id: string) {
  const timer = running.get(id)
  if (!timer) return
  running.delete(id)
  island.upsert(
    "timer",
    {
      timerId: id,
      label: timer.label,
      endsAt: timer.endsAt,
      durationMs: timer.durationMs,
      finished: true,
    },
    { id: activityId(id), ttlMs: 10_000, size: "expanded", priority: 85 },
  )
  playSound("alarm-clock-elapsed")
  notify("Timer done", timer.label || "Your timer has finished.", "alarm-symbolic")
}

export function startTimer(
  durationMs: number,
  label = "",
  id = `t${Date.now().toString(36)}`,
  endsAt?: number,
) {
  cancelTimer(id)
  const end = endsAt ?? Date.now() + durationMs
  const remaining = Math.max(0, end - Date.now())
  const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, remaining, () => {
    finish(id)
    return GLib.SOURCE_REMOVE
  })
  running.set(id, { id, label, endsAt: end, durationMs, source })
  island.upsert(
    "timer",
    { timerId: id, label, endsAt: end, durationMs, finished: false },
    { id: activityId(id) },
  )
  return id
}

export function cancelTimer(id: string) {
  const timer = running.get(id)
  if (timer) {
    GLib.source_remove(timer.source)
    running.delete(id)
  }
  island.dismiss(activityId(id))
}

export function runningTimers() {
  return [...running.values()].map(({ id, label, endsAt, durationMs }) => ({
    id,
    label,
    endsAt,
    durationMs,
  }))
}
