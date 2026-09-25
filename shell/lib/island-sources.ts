/**
 * Everything that feeds the Dynamic Island: notifications, media, volume, brightness,
 * battery, the welcome greeting, and events from assistantd. Call setupIslandSources() once
 * from the app's root scope.
 */
import GLib from "gi://GLib?version=2.0"
import { island } from "./island"
import { config, updateConfig } from "./config"
import { battery, mpris, notifd, speaker, AstalMpris, AstalNotifd } from "./services"
import { brightness, hasBacklight } from "./brightness"
import { volumeIcon } from "./audio"
import { formatRemaining } from "./format"
import { followSystemEvents } from "./assistant"
import { cancelTimer, startTimer } from "./timers"
import { notify } from "./system"
import type { MediaPayload } from "./island-queue"

/** Suppress OSDs for the burst of property notifications at startup. */
let ready = false

function urgencyName(urgency: AstalNotifd.Urgency): "low" | "normal" | "critical" {
  if (urgency === AstalNotifd.Urgency.CRITICAL) return "critical"
  if (urgency === AstalNotifd.Urgency.LOW) return "low"
  return "normal"
}

function setupNotifications() {
  if (!notifd) return
  const server = notifd
  // Keep notifd's Do Not Disturb and the config in sync, both directions.
  server.dontDisturb = config.peek().notifications.doNotDisturb
  config.subscribe(() => {
    const wanted = config.peek().notifications.doNotDisturb
    if (server.dontDisturb !== wanted) server.dontDisturb = wanted
  })
  server.connect("notify::dont-disturb", () => {
    if (config.peek().notifications.doNotDisturb !== server.dontDisturb) {
      updateConfig((c) => (c.notifications.doNotDisturb = server.dontDisturb))
    }
  })

  server.connect("notified", (_server, id) => {
    const n = server.get_notification(id)
    if (!n || !config.peek().island.notifications) return
    const urgency = urgencyName(n.urgency)
    if (server.dontDisturb && urgency !== "critical") return
    island.upsert(
      "notification",
      {
        notificationId: id,
        appName: n.appName ?? "",
        appIcon: n.appIcon ?? n.desktopEntry ?? "",
        image: n.image ?? "",
        summary: n.summary,
        body: n.body,
        urgency,
        actions: n.actions.map((a) => ({ id: a.id, label: a.label })),
      },
      { id: `notification:${id}`, ttlMs: urgency === "critical" ? 12_000 : undefined },
    )
  })
  server.connect("resolved", (_server, id) => island.dismiss(`notification:${id}`))
}

function setupMedia() {
  if (!mpris) return
  const players = mpris
  const watched = new WeakSet<AstalMpris.Player>()

  const update = () => {
    if (!config.peek().island.media) {
      island.dismiss("media")
      return
    }
    const list = players.players
    const playing = list.find((p) => p.playbackStatus === AstalMpris.PlaybackStatus.PLAYING)
    const shown =
      playing ??
      list.find(
        (p) => p.busName === (island.get("media")?.payload as MediaPayload | undefined)?.busName,
      )
    if (!shown || shown.playbackStatus === AstalMpris.PlaybackStatus.STOPPED) {
      island.dismiss("media")
      return
    }
    const payload: MediaPayload = {
      title: shown.title || shown.identity,
      artist: shown.artist,
      coverArt: shown.coverArt,
      playing: shown.playbackStatus === AstalMpris.PlaybackStatus.PLAYING,
      busName: shown.busName,
    }
    // Paused media lingers briefly, then leaves the island.
    island.upsert("media", payload, { id: "media", ttlMs: payload.playing ? null : 8000 })
  }

  const watch = (player: AstalMpris.Player) => {
    if (watched.has(player)) return
    watched.add(player)
    player.connect("notify::playback-status", update)
    player.connect("notify::title", update)
    player.connect("notify::artist", update)
    player.connect("notify::cover-art", update)
  }

  players.players.forEach(watch)
  players.connect("player-added", (_m, player) => {
    watch(player)
    update()
  })
  players.connect("player-closed", update)
  update()
}

export function showVolumeOsd() {
  if (!speaker || !config.peek().island.osd) return
  island.upsert(
    "volume",
    { value: speaker.volume, muted: speaker.mute, icon: volumeIcon(speaker.volume, speaker.mute) },
    { id: "osd" },
  )
}

export function showBrightnessOsd() {
  if (!hasBacklight || !config.peek().island.osd) return
  const value = brightness.peek()
  island.upsert(
    "brightness",
    {
      value,
      muted: false,
      icon: value < 0.5 ? "display-brightness-low-symbolic" : "display-brightness-high-symbolic",
    },
    { id: "osd" },
  )
}

function setupOsd() {
  speaker?.connect("notify::volume", () => ready && showVolumeOsd())
  speaker?.connect("notify::mute", () => ready && showVolumeOsd())
  brightness.subscribe(() => ready && showBrightnessOsd())
}

function setupBattery() {
  if (!battery) return
  const device = battery
  let lastWarning = 101

  const detail = () => {
    if (device.charging) {
      const full = formatRemaining(device.timeToFull)
      return full ? `${full} until full` : "Charging"
    }
    const left = formatRemaining(device.timeToEmpty)
    return left ? `${left} remaining` : ""
  }

  device.connect("notify::charging", () => {
    if (!ready || !config.peek().island.battery) return
    lastWarning = 101
    island.upsert(
      "battery",
      {
        percent: device.percentage,
        charging: device.charging,
        low: false,
        detail: device.charging ? "Charging" : "On battery",
      },
      { id: "battery" },
    )
  })

  device.connect("notify::percentage", () => {
    if (device.charging) return
    const percent = Math.round(device.percentage * 100)
    const threshold = [20, 10, 5].find((t) => percent <= t && lastWarning > t)
    if (threshold === undefined) return
    lastWarning = threshold
    island.upsert(
      "battery",
      {
        percent: device.percentage,
        charging: false,
        low: true,
        detail: detail() || "Plug in soon",
      },
      { id: "battery", ttlMs: 8000 },
    )
  })
}

function setupAssistantEvents() {
  followSystemEvents((event) => {
    switch (event.type) {
      case "timer_started":
        startTimer(event.duration_ms, event.label, event.timer_id, event.ends_at_ms)
        break
      case "timer_cancelled":
        cancelTimer(event.timer_id)
        break
      case "notify":
        notify(event.title, event.body, "newos-sparkle-symbolic")
        break
      case "provider_changed":
        break
    }
  })
}

function welcome() {
  const name = GLib.get_real_name()
  const first = name && name !== "Unknown" ? name.split(" ")[0] : GLib.get_user_name()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  island.upsert(
    "space",
    {
      name: first ?? "",
      accent: config.peek().appearance.accent,
      icon: "newos-logo-symbolic",
      greeting,
    },
    { id: "space" },
  )
}

export function setupIslandSources() {
  setupNotifications()
  setupMedia()
  setupOsd()
  setupBattery()
  setupAssistantEvents()
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
    ready = true
    welcome()
    return GLib.SOURCE_REMOVE
  })
}
