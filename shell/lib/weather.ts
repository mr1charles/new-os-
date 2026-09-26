/**
 * Weather for the desktop widget: the city from Settings → Widgets, looked up once with
 * Open-Meteo's geocoder, then the forecast every 15 minutes. No account or key; only the city
 * name and its coordinates leave the computer.
 */
import GLib from "gi://GLib?version=2.0"
import { fetch } from "ags/fetch"
import { createState } from "ags"
import { config } from "./config"
import { forecastUrl, geocodeUrl, parseForecast, type Weather } from "./desktop-widgets"

export type WeatherState =
  | { status: "unset" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; weather: Weather }

const [weather, setWeather] = createState<WeatherState>({ status: "unset" })
export { weather }

let place: { key: string; name: string; latitude: number; longitude: number } | null = null
let timer: number | null = null
let generation = 0

async function locate(city: string) {
  if (place?.key === city) return place
  const response = await fetch(geocodeUrl(city))
  const json = (await response.json()) as {
    results?: {
      name: string
      admin1?: string
      country_code?: string
      latitude: number
      longitude: number
    }[]
  }
  const hit = json.results?.[0]
  if (!hit) throw new Error(`Couldn’t find “${city}”.`)
  place = { key: city, name: hit.name, latitude: hit.latitude, longitude: hit.longitude }
  return place
}

async function refresh() {
  const c = config.peek()
  const city = c.widgets.city.trim()
  const mine = ++generation
  if (!city) {
    setWeather({ status: "unset" })
    return
  }
  if (weather.peek().status !== "ready") setWeather({ status: "loading" })
  try {
    const p = await locate(city)
    const response = await fetch(forecastUrl(p.latitude, p.longitude, c.widgets.fahrenheit))
    const parsed = parseForecast(p.name, await response.json(), c.bar.clock24h)
    if (mine !== generation) return
    setWeather(
      parsed
        ? { status: "ready", weather: parsed }
        : { status: "error", message: "No forecast right now." },
    )
  } catch (e) {
    if (mine !== generation) return
    // Keep showing the last forecast when a refresh fails (offline for a moment).
    if (weather.peek().status !== "ready")
      setWeather({ status: "error", message: e instanceof Error ? e.message : String(e) })
  }
}

let started = false
/** Start fetching (once), and again when the city, units, or clock format change. */
export function startWeather() {
  if (started) return
  started = true
  let last = ""
  const onConfig = () => {
    const c = config.peek()
    const key = `${c.widgets.city}|${c.widgets.fahrenheit}|${c.bar.clock24h}`
    if (key === last) return
    last = key
    void refresh()
  }
  config.subscribe(onConfig)
  onConfig()
  timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15 * 60, () => {
    void refresh()
    return GLib.SOURCE_CONTINUE
  })
}

export function stopWeather() {
  if (timer !== null) GLib.source_remove(timer)
  timer = null
}
