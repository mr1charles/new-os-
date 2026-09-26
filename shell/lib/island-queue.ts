/**
 * Dynamic Island activity queue.
 *
 * Everything that wants to appear in the island (notifications, media, volume and brightness
 * changes, battery events, timers, installs, the assistant, confirmations, space switches)
 * becomes an Activity. The island always shows the highest-priority activity that has not
 * expired; ties go to the most recently updated one. Transient activities carry a TTL, while
 * live activities (media, timers, installs) stay until removed.
 *
 * This module is pure TypeScript with no GJS imports so it can be unit tested in Node.
 */

export interface NotificationPayload {
  notificationId: number | null
  appName: string
  appIcon: string
  image: string
  summary: string
  body: string
  urgency: "low" | "normal" | "critical"
  actions: { id: string; label: string }[]
}

export interface MediaPayload {
  title: string
  artist: string
  coverArt: string
  playing: boolean
  busName: string
}

export interface LevelPayload {
  /** 0.0 - 1.0 */
  value: number
  muted: boolean
  icon: string
}

export interface BatteryPayload {
  percent: number
  charging: boolean
  low: boolean
  detail: string
}

export interface TimerPayload {
  timerId: string
  label: string
  /** Epoch milliseconds. */
  endsAt: number
  durationMs: number
  finished: boolean
}

export interface InstallPayload {
  name: string
  /** 0.0 - 1.0 */
  progress: number
  icon: string
  status: string
}

export interface AssistantPayload {
  phase: "thinking" | "responding" | "tool" | "done" | "error"
  text: string
  provider: string
  tool: string
}

export interface ConfirmPayload {
  requestId: string
  tool: string
  summary: string
}

export interface SpacePayload {
  name: string
  accent: string
  icon: string
  greeting: string
}

/** A live activity from an app (org.newos.Island1 Show): a copy, a download, a build. */
export interface AppActivityPayload {
  /** The app's window class or desktop id, e.g. "newos-files". */
  app: string
  icon: string
  title: string
  subtitle: string
  /** 0.0 - 1.0, or null for "working on it" without a known end. */
  progress: number | null
}

export interface IslandPayloads {
  confirm: ConfirmPayload
  assistant: AssistantPayload
  volume: LevelPayload
  brightness: LevelPayload
  space: SpacePayload
  battery: BatteryPayload
  notification: NotificationPayload
  timer: TimerPayload
  install: InstallPayload
  activity: AppActivityPayload
  media: MediaPayload
}

export type IslandKind = keyof IslandPayloads
export type IslandSize = "compact" | "expanded" | "large"

interface ActivityBase {
  id: string
  priority: number
  size: IslandSize
  /** Epoch milliseconds, or null for live activities. */
  expiresAt: number | null
  updatedAt: number
  /** Monotonic counter used to break ties between equal priorities. */
  seq: number
}

export type Activity = {
  [K in IslandKind]: ActivityBase & { kind: K; payload: IslandPayloads[K] }
}[IslandKind]

export type ActivityOf<K extends IslandKind> = Extract<Activity, { kind: K }>

/** Higher wins. Confirmations always win because they block an action. */
export const PRIORITY: Record<IslandKind, number> = {
  confirm: 100,
  assistant: 90,
  volume: 80,
  brightness: 80,
  space: 75,
  battery: 70,
  notification: 60,
  timer: 50,
  install: 45,
  activity: 45,
  media: 40,
}

/** How big the island gets for an activity when the pointer is not over it. */
export const DEFAULT_SIZE: Record<IslandKind, IslandSize> = {
  confirm: "large",
  assistant: "large",
  volume: "expanded",
  brightness: "expanded",
  space: "expanded",
  battery: "expanded",
  notification: "expanded",
  timer: "compact",
  install: "compact",
  activity: "compact",
  media: "compact",
}

/** Default time on screen for transient activities. Live activities have no TTL. */
export const DEFAULT_TTL_MS: Record<IslandKind, number | null> = {
  confirm: null,
  assistant: null,
  volume: 1500,
  brightness: 1500,
  space: 2500,
  battery: 4000,
  notification: 5500,
  timer: null,
  install: null,
  // Apps end their activities; this only guards against an app that crashed mid-way.
  activity: 10 * 60_000,
  media: null,
}

export interface UpsertOptions {
  /** Stable id. Pushing the same id again replaces the activity in place. */
  id?: string
  /** Time to live in ms. `null` makes the activity live until dismissed. */
  ttlMs?: number | null
  priority?: number
  size?: IslandSize
}

type Listener = () => void

export class IslandQueue {
  #items = new Map<string, Activity>()
  #seq = 0
  #listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit() {
    for (const listener of [...this.#listeners]) listener()
  }

  upsert<K extends IslandKind>(
    kind: K,
    payload: IslandPayloads[K],
    options: UpsertOptions = {},
    now: number = Date.now(),
  ): ActivityOf<K> {
    const id = options.id ?? kind
    const ttl = options.ttlMs === undefined ? DEFAULT_TTL_MS[kind] : options.ttlMs
    const activity = {
      id,
      kind,
      payload,
      priority: options.priority ?? PRIORITY[kind],
      size: options.size ?? DEFAULT_SIZE[kind],
      expiresAt: ttl === null ? null : now + ttl,
      updatedAt: now,
      seq: ++this.#seq,
    } as ActivityOf<K>
    this.#items.set(id, activity)
    this.#emit()
    return activity
  }

  /** Update the payload of an existing activity without changing its expiry or order. */
  patch<K extends IslandKind>(id: string, kind: K, patch: Partial<IslandPayloads[K]>): boolean {
    const existing = this.#items.get(id)
    if (!existing || existing.kind !== kind) return false
    this.#items.set(id, {
      ...existing,
      payload: { ...existing.payload, ...patch },
    } as Activity)
    this.#emit()
    return true
  }

  /** Push the expiry of a transient activity out, for example while it is hovered. */
  extend(id: string, ttlMs: number, now: number = Date.now()): boolean {
    const existing = this.#items.get(id)
    if (!existing || existing.expiresAt === null) return false
    existing.expiresAt = Math.max(existing.expiresAt, now + ttlMs)
    return true
  }

  /** Set a transient activity to expire `ttlMs` from now (shorter or longer). */
  retime(id: string, ttlMs: number, now: number = Date.now()): boolean {
    const existing = this.#items.get(id)
    if (!existing || existing.expiresAt === null) return false
    existing.expiresAt = now + ttlMs
    this.#emit()
    return true
  }

  dismiss(id: string): boolean {
    const removed = this.#items.delete(id)
    if (removed) this.#emit()
    return removed
  }

  dismissKind(kind: IslandKind): number {
    let count = 0
    for (const [id, activity] of this.#items) {
      if (activity.kind === kind) {
        this.#items.delete(id)
        count++
      }
    }
    if (count > 0) this.#emit()
    return count
  }

  get(id: string): Activity | undefined {
    return this.#items.get(id)
  }

  /** Remove expired activities. Returns true when something was removed. */
  prune(now: number = Date.now()): boolean {
    let removed = false
    for (const [id, activity] of this.#items) {
      if (activity.expiresAt !== null && activity.expiresAt <= now) {
        this.#items.delete(id)
        removed = true
      }
    }
    if (removed) this.#emit()
    return removed
  }

  /** The activity the island should display right now. */
  current(now: number = Date.now()): Activity | null {
    let best: Activity | null = null
    for (const activity of this.#items.values()) {
      if (activity.expiresAt !== null && activity.expiresAt <= now) continue
      if (
        !best ||
        activity.priority > best.priority ||
        (activity.priority === best.priority && activity.seq > best.seq)
      ) {
        best = activity
      }
    }
    return best
  }

  /** Activities waiting behind the current one, highest priority first. */
  list(now: number = Date.now()): Activity[] {
    return [...this.#items.values()]
      .filter((a) => a.expiresAt === null || a.expiresAt > now)
      .sort((a, b) => b.priority - a.priority || b.seq - a.seq)
  }

  /** Epoch ms of the next expiry, so the caller can schedule a single timer. */
  nextExpiry(): number | null {
    let next: number | null = null
    for (const activity of this.#items.values()) {
      if (activity.expiresAt !== null && (next === null || activity.expiresAt < next)) {
        next = activity.expiresAt
      }
    }
    return next
  }

  get size(): number {
    return this.#items.size
  }
}

/** Live activities have a compact form that grows when hovered. */
export function hasCompactForm(kind: IslandKind): boolean {
  return DEFAULT_SIZE[kind] === "compact"
}

/** Size the island should render at, given the current activity and pointer state. */
export function resolveIslandSize(activity: Activity | null, hovered: boolean): IslandSize {
  if (!activity) return hovered ? "expanded" : "compact"
  if (activity.size === "compact" && hovered) return "expanded"
  return activity.size
}

/** Name of the island stack page for an activity. Compact live activities have their own page. */
export function islandPageName(activity: Activity | null, size: IslandSize): string {
  if (!activity) return size === "compact" ? "idle-compact" : "idle"
  if (size === "compact" && hasCompactForm(activity.kind)) return `${activity.kind}-compact`
  return activity.kind
}

/** Keys of apps as they appear in window classes and desktop ids, for matching the two. */
export function sameApp(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\.desktop$/, "")
      .replace(/^org\.newos\./, "newos-")
  return a !== "" && b !== "" && norm(a) === norm(b)
}

/**
 * Size in context: an app's own activity stays compact while that app is in front (the app
 * shows it already), unless the pointer is over the island.
 */
export function contextualSize(
  activity: Activity | null,
  hovered: boolean,
  focusedApp: string,
): IslandSize {
  if (activity?.kind === "activity" && !hovered && sameApp(activity.payload.app, focusedApp))
    return "compact"
  return resolveIslandSize(activity, hovered)
}

/** Over a fullscreen app the island hides, except for what needs you now. */
export function visibleOverFullscreen(activity: Activity | null): boolean {
  if (!activity) return false
  if (activity.kind === "confirm" || activity.kind === "volume" || activity.kind === "brightness")
    return true
  return activity.kind === "notification" && activity.payload.urgency === "critical"
}

/**
 * How wide the island is when it rests in the menu bar, so the bar keeps that much room free
 * in the middle (the island never covers status icons).
 */
export function restingWidth(activity: Activity | null): number {
  if (!activity) return 190
  return activity.size === "compact" && hasCompactForm(activity.kind) ? 250 : 190
}
