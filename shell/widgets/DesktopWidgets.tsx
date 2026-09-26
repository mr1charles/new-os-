import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import { createBinding, createComputed, createState, For, With, onCleanup } from "ags"
import { config, updateConfig } from "../lib/config"
import { now } from "../lib/clock"
import { battery, bluetooth } from "../lib/services"
import {
  batteryRings,
  clockAngles,
  describeWeather,
  monthGrid,
  shownWidgets,
  WIDGET_INFO,
  WIDGET_KINDS,
  WIDGET_SIZE,
  widgetRows,
  type BatteryRing,
  type WidgetKind,
} from "../lib/desktop-widgets"
import { startWeather, weather } from "../lib/weather"
import { openSettings } from "../lib/system"

const VERTICAL = Gtk.Orientation.VERTICAL
const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

const [editing, setEditing] = createState(false)
export { editing }

/** Edit mode: widgets show a remove button and the gallery opens to add more. */
export function editWidgets(on: boolean = !editing.peek()) {
  setEditing(on)
}

const kinds = config.as((c) => (c.widgets.show ? shownWidgets(c.widgets.items) : []))

function removeWidget(kind: WidgetKind) {
  updateConfig((c) => (c.widgets.items = c.widgets.items.filter((k) => k !== kind)))
}

function addWidget(kind: WidgetKind) {
  updateConfig((c) => {
    c.widgets.show = true
    if (!c.widgets.items.includes(kind)) c.widgets.items = [...c.widgets.items, kind]
  })
}

// ---------------------------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------------------------

function CityEntry() {
  return (
    <box orientation={VERTICAL} spacing={8} valign={Gtk.Align.CENTER} vexpand>
      <label class="widget-title" label="Weather" xalign={0} />
      <label class="widget-dim" label="Which city should it show?" xalign={0} />
      <entry
        class="widget-entry"
        placeholderText="London, Tokyo, New York…"
        onActivate={(self) => {
          const city = self.text.trim()
          if (city) updateConfig((c) => (c.widgets.city = city))
        }}
      />
    </box>
  )
}

function WeatherWidget() {
  return (
    <box class="widget-body">
      <With value={weather}>
        {(state) => {
          if (state.status === "unset") return <CityEntry />
          if (state.status === "loading")
            return <label class="widget-dim" label="Loading weather…" hexpand vexpand />
          if (state.status === "error")
            return (
              <box orientation={VERTICAL} spacing={6} valign={Gtk.Align.CENTER} hexpand>
                <label class="widget-title" label="Weather" xalign={0} />
                <label class="widget-dim" label={state.message} xalign={0} wrap />
                <button class="widget-link" onClicked={() => openSettings("widgets")}>
                  <label label="Change City…" />
                </button>
              </box>
            )
          const w = state.weather
          const now = describeWeather(w.code, w.isDay)
          return (
            <box orientation={VERTICAL} hexpand spacing={4}>
              <box spacing={4}>
                <label class="widget-place" label={w.place} xalign={0} />
                <image
                  iconName="mark-location-symbolic"
                  pixelSize={11}
                  class="widget-place-arrow"
                />
                <box hexpand />
                <image iconName={now.icon} pixelSize={18} />
              </box>
              <box>
                <label
                  class="weather-temp"
                  label={`${w.temperature}°`}
                  xalign={0}
                  valign={Gtk.Align.START}
                  hexpand
                />
                <box orientation={VERTICAL} valign={Gtk.Align.END} class="weather-summary">
                  <label label={now.text} xalign={1} />
                  <label label={`H:${w.high}° L:${w.low}°`} xalign={1} />
                </box>
              </box>
              <box class="weather-hours" homogeneous>
                {w.hours.map((h) => (
                  <box orientation={VERTICAL} spacing={4}>
                    <label class="weather-hour" label={h.label} />
                    <image iconName={describeWeather(h.code, h.isDay).icon} pixelSize={16} />
                    <label class="weather-hour-temp" label={`${h.temperature}°`} />
                  </box>
                ))}
              </box>
            </box>
          )
        }}
      </With>
    </box>
  )
}

// ---------------------------------------------------------------------------------------------
// Batteries
// ---------------------------------------------------------------------------------------------

function Ring({ ring }: { ring: BatteryRing }) {
  const area = new Gtk.DrawingArea({ contentWidth: 58, contentHeight: 58 })
  area.set_draw_func((_area, cr, width, height) => {
    const r = Math.min(width, height) / 2 - 4
    const cx = width / 2
    const cy = height / 2
    cr.setLineWidth(5)
    cr.setSourceRGBA(1, 1, 1, 0.14)
    cr.arc(cx, cy, r, 0, 2 * Math.PI)
    cr.stroke()
    if (ring.level !== null) {
      const low = ring.level <= 0.2 && !ring.charging
      if (ring.charging) cr.setSourceRGBA(0.2, 0.84, 0.35, 1)
      else if (low) cr.setSourceRGBA(1, 0.27, 0.23, 1)
      else cr.setSourceRGBA(1, 1, 1, 0.92)
      cr.setLineCap(1) // round
      const start = -Math.PI / 2
      cr.arc(cx, cy, r, start, start + 2 * Math.PI * Math.max(0.02, ring.level))
      cr.stroke()
    }
    cr.$dispose()
  })
  return (
    <box orientation={VERTICAL} spacing={6} hexpand>
      <overlay halign={Gtk.Align.CENTER}>
        {area}
        <image
          $type="overlay"
          iconName={ring.icon || "content-loading-symbolic"}
          visible={ring.level !== null}
          pixelSize={20}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </overlay>
      <label
        class="battery-ring-label"
        label={ring.level === null ? " " : `${Math.round(ring.level * 100)}%`}
        tooltipText={ring.label}
      />
    </box>
  )
}

function BatteriesWidget() {
  const level = battery ? createBinding(battery, "percentage") : createState(0)[0]
  const charging = battery ? createBinding(battery, "charging") : createState(false)[0]
  const present = battery ? createBinding(battery, "isPresent") : createState(false)[0]
  const devices = bluetooth ? createBinding(bluetooth, "devices") : createState([])[0]
  // Device battery levels change without the device list changing; re-read every minute.
  const rings = createComputed(() => {
    now()
    return batteryRings(
      present() ? { level: level(), charging: charging() } : null,
      devices()
        .filter((d) => d.connected)
        .map((d) => ({ name: d.name, icon: d.icon, level: d.battery_percentage })),
    )
  })
  const key = rings.as((list) =>
    list.map((r) => `${r.icon}:${Math.round((r.level ?? -1) * 100)}:${r.charging}`).join(","),
  )
  return (
    <box class="widget-body" valign={Gtk.Align.CENTER}>
      <With value={key}>
        {() => (
          <box homogeneous hexpand>
            {rings.peek().map((ring) => (
              <Ring ring={ring} />
            ))}
          </box>
        )}
      </With>
    </box>
  )
}

// ---------------------------------------------------------------------------------------------
// Clock and calendar
// ---------------------------------------------------------------------------------------------

function ClockWidget() {
  const area = new Gtk.DrawingArea({
    contentWidth: 150,
    contentHeight: 150,
    hexpand: true,
    vexpand: true,
  })
  area.set_draw_func((_area, cr, width, height) => {
    const size = Math.min(width, height)
    const cx = width / 2
    const cy = height / 2
    const r = size / 2 - 2
    cr.setSourceRGBA(0.97, 0.97, 0.97, 1)
    cr.arc(cx, cy, r, 0, 2 * Math.PI)
    cr.fill()
    // Minute ticks, longer every five.
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 2 * Math.PI
      const long = i % 5 === 0
      cr.setSourceRGBA(0.1, 0.1, 0.1, long ? 0.8 : 0.35)
      cr.setLineWidth(long ? 1.6 : 0.8)
      cr.moveTo(cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4))
      cr.lineTo(cx + Math.sin(a) * (r - (long ? 10 : 7)), cy - Math.cos(a) * (r - (long ? 10 : 7)))
      cr.stroke()
    }
    // Numbers.
    cr.setSourceRGBA(0.08, 0.08, 0.08, 1)
    cr.selectFontFace("Inter", 0, 0)
    cr.setFontSize(size * 0.11)
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * 2 * Math.PI
      const text = String(n)
      const ext = cr.textExtents(text)
      const d = r - size * 0.17
      cr.moveTo(
        cx + Math.sin(a) * d - ext.width / 2 - ext.xBearing,
        cy - Math.cos(a) * d - ext.height / 2 - ext.yBearing,
      )
      cr.showText(text)
    }
    const { hour, minute, second } = clockAngles(new Date())
    const hand = (
      deg: number,
      length: number,
      width: number,
      rgba: [number, number, number, number],
    ) => {
      const a = (deg * Math.PI) / 180
      cr.setSourceRGBA(...rgba)
      cr.setLineWidth(width)
      cr.setLineCap(1)
      cr.moveTo(cx - Math.sin(a) * length * 0.12, cy + Math.cos(a) * length * 0.12)
      cr.lineTo(cx + Math.sin(a) * length, cy - Math.cos(a) * length)
      cr.stroke()
    }
    hand(hour, r * 0.5, size * 0.035, [0.08, 0.08, 0.08, 1])
    hand(minute, r * 0.76, size * 0.028, [0.08, 0.08, 0.08, 1])
    hand(second, r * 0.82, size * 0.01, [1, 0.58, 0, 1])
    cr.setSourceRGBA(1, 0.58, 0, 1)
    cr.arc(cx, cy, size * 0.022, 0, 2 * Math.PI)
    cr.fill()
    cr.$dispose()
  })
  const unsubscribe = now.subscribe(() => area.queue_draw())
  onCleanup(unsubscribe)
  return <box class="widget-body clock-body">{area}</box>
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]

function CalendarWidget() {
  const day = now.as((t) => new Date(t).toDateString())
  return (
    <box class="widget-body">
      <With value={day}>
        {() => {
          const today = new Date()
          const weeks = monthGrid(today.getFullYear(), today.getMonth())
          const month = today.toLocaleDateString(undefined, { month: "long" }).toUpperCase()
          return (
            <box orientation={VERTICAL} spacing={3} hexpand>
              <label class="calendar-month" label={month} xalign={0} />
              <box homogeneous>
                {WEEKDAYS.map((d) => (
                  <label class="calendar-weekday" label={d} />
                ))}
              </box>
              {weeks.map((week) => (
                <box homogeneous>
                  {week.map((d) => (
                    <label
                      class={d === today.getDate() ? "calendar-day today" : "calendar-day"}
                      label={d === null ? "" : String(d)}
                    />
                  ))}
                </box>
              ))}
            </box>
          )
        }}
      </With>
    </box>
  )
}

const VIEWS: Record<WidgetKind, () => JSX.Element> = {
  weather: WeatherWidget,
  batteries: BatteriesWidget,
  clock: ClockWidget,
  calendar: CalendarWidget,
}

/** One widget card, with a remove button while editing. */
function Card({ kind }: { kind: WidgetKind }) {
  const View = VIEWS[kind]
  return (
    <overlay class={editing.as((e) => `widget-card-wrap ${e ? "editing" : ""}`)}>
      <box
        class={`desktop-widget ${WIDGET_SIZE[kind]} widget-${kind}`}
        overflow={Gtk.Overflow.HIDDEN}
      >
        <View />
      </box>
      <button
        $type="overlay"
        class="widget-remove"
        visible={editing}
        halign={Gtk.Align.START}
        valign={Gtk.Align.START}
        tooltipText={`Remove ${WIDGET_INFO[kind].name}`}
        onClicked={() => removeWidget(kind)}
      >
        <image iconName="list-remove-symbolic" pixelSize={12} />
      </button>
    </overlay>
  )
}

/**
 * Widgets on the desktop, like macOS: weather, batteries, a clock, and a calendar, in a column
 * behind windows. Right-click the desktop → Edit Widgets to remove them or add more.
 */
export default function DesktopWidgets({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  startWeather()
  const side = config.as((c) => c.widgets.side)
  const rows = kinds.as((k) => widgetRows(k))
  const rowsKey = rows.as((r) => JSON.stringify(r))
  return (
    <window
      name={`widgets-${gdkmonitor.connector}`}
      namespace="helixos-widgets"
      class="widgets-window"
      gdkmonitor={gdkmonitor}
      application={app}
      layer={Astal.Layer.BOTTOM}
      anchor={side.as((s) => TOP | (s === "left" ? LEFT : RIGHT))}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      marginTop={56}
      marginLeft={side.as((s) => (s === "left" ? 24 : 0))}
      marginRight={side.as((s) => (s === "right" ? 24 : 0))}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={kinds.as((k) => k.length > 0)}
    >
      <With value={rowsKey}>
        {() => (
          <box orientation={VERTICAL} spacing={14}>
            {rows.peek().map((row) => (
              <box spacing={14}>
                {row.map((kind) => (
                  <Card kind={kind} />
                ))}
              </box>
            ))}
          </box>
        )}
      </With>
    </window>
  )
}

/** The widget gallery while editing: add widgets, then Done. */
export function WidgetGallery() {
  const added = config.as((c) => new Set(shownWidgets(c.widgets.items)))
  return (
    <window
      name="widget-gallery"
      namespace="helixos-widget-gallery"
      class="widget-gallery-window"
      application={app}
      layer={Astal.Layer.TOP}
      anchor={BOTTOM}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      marginBottom={120}
      // Shown last: Astal applies the layer only before the window is mapped.
      visible={editing}
    >
      <box class="widget-gallery panel" orientation={VERTICAL} spacing={14}>
        <box spacing={8}>
          <box orientation={VERTICAL} hexpand>
            <label class="widget-gallery-title" label="Widgets" xalign={0} />
            <label
              class="widget-dim"
              label="Add widgets to your desktop. Remove one with its − button."
              xalign={0}
            />
          </box>
          <button
            class="pill suggested"
            valign={Gtk.Align.CENTER}
            onClicked={() => editWidgets(false)}
          >
            <label label="Done" />
          </button>
        </box>
        <box spacing={12}>
          <For each={createState([...WIDGET_KINDS])[0]}>
            {(kind: WidgetKind) => (
              <button
                class={added.as((a) => (a.has(kind) ? "widget-tile added" : "widget-tile"))}
                sensitive={added.as((a) => !a.has(kind))}
                onClicked={() => addWidget(kind)}
              >
                <box orientation={VERTICAL} spacing={6} widthRequest={128}>
                  <image iconName={WIDGET_INFO[kind].icon} pixelSize={32} />
                  <label class="widget-tile-name" label={WIDGET_INFO[kind].name} />
                  <label
                    class="widget-dim"
                    label={added.as((a) =>
                      a.has(kind) ? "On your desktop" : WIDGET_INFO[kind].description,
                    )}
                    wrap
                    justify={Gtk.Justification.CENTER}
                    maxWidthChars={16}
                  />
                </box>
              </button>
            )}
          </For>
        </box>
      </box>
    </window>
  )
}
