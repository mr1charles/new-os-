import { describe, expect, it } from "vitest"
import {
  batteryRings,
  clockAngles,
  describeWeather,
  forecastUrl,
  geocodeUrl,
  hourLabel,
  monthGrid,
  parseForecast,
  shownWidgets,
  widgetRows,
} from "./desktop-widgets"

describe("widgets", () => {
  it("keeps known kinds once, in order", () => {
    expect(shownWidgets(["clock", "weather", "bogus", "clock"])).toEqual(["clock", "weather"])
  })
})

describe("weather", () => {
  it("describes WMO codes, with night icons", () => {
    expect(describeWeather(0, true)).toEqual({ text: "Sunny", icon: "weather-clear-symbolic" })
    expect(describeWeather(0, false)).toEqual({
      text: "Clear",
      icon: "weather-clear-night-symbolic",
    })
    expect(describeWeather(2, false).icon).toBe("weather-few-clouds-night-symbolic")
    expect(describeWeather(63, true).text).toBe("Rain")
    expect(describeWeather(75, true).icon).toBe("weather-snow-symbolic")
    expect(describeWeather(96, true).text).toBe("Thunderstorms")
  })

  it("builds request URLs", () => {
    expect(forecastUrl(51.5072, -0.1276, false)).toContain("latitude=51.507&longitude=-0.128")
    expect(forecastUrl(1, 2, true)).toContain("temperature_unit=fahrenheit")
    expect(geocodeUrl(" New York ")).toContain("name=New%20York")
  })

  it("reads a forecast: now, range, and the next hours", () => {
    const json = {
      current: { time: "2026-03-05T00:15", temperature_2m: 9.4, weather_code: 2, is_day: 0 },
      hourly: {
        time: Array.from({ length: 10 }, (_, i) => `2026-03-05T${String(i).padStart(2, "0")}:00`),
        temperature_2m: [9, 8.4, 8, 7.6, 7.4, 7, 6.8, 6.6, 7, 8],
        weather_code: [2, 2, 1, 1, 0, 0, 0, 0, 1, 2],
        is_day: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
      },
      daily: { temperature_2m_max: [17.2], temperature_2m_min: [6.6] },
    }
    const w = parseForecast("Newham, London", json, false)!
    expect(w).toMatchObject({
      place: "Newham, London",
      temperature: 9,
      code: 2,
      isDay: false,
      high: 17,
      low: 7,
    })
    expect(w.hours.map((h) => h.label)).toEqual(["1 am", "2 am", "3 am", "4 am", "5 am", "6 am"])
    expect(w.hours[0]!.temperature).toBe(8)
    expect(parseForecast("x", {}, false)).toBeNull()
  })

  it("labels hours both ways", () => {
    expect(hourLabel(0, false)).toBe("12 am")
    expect(hourLabel(13, false)).toBe("1 pm")
    expect(hourLabel(7, true)).toBe("07:00")
  })
})

describe("calendar and clock", () => {
  it("lays out March 2026 from Monday", () => {
    const weeks = monthGrid(2026, 2)
    expect(weeks[0]).toEqual([null, null, null, null, null, null, 1])
    expect(weeks.at(-1)).toEqual([30, 31, null, null, null, null, null])
    expect(monthGrid(2026, 2, false)[0]).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("points the hands", () => {
    const a = clockAngles(new Date(2026, 0, 1, 3, 30, 0))
    expect(a.hour).toBe(105)
    expect(a.minute).toBe(180)
    expect(a.second).toBe(0)
  })
})

describe("battery rings", () => {
  it("puts the computer first and fills empty slots", () => {
    const rings = batteryRings({ level: 0.4, charging: true }, [
      { name: "AirPods", icon: "audio-headphones", level: 0.3 },
      { name: "Mouse", icon: "input-mouse", level: -1 },
    ])
    expect(rings.map((r) => r.level)).toEqual([0.4, 0.3, null, null])
    expect(rings[1]!.icon).toBe("audio-headphones-symbolic")
    expect(rings[0]!.charging).toBe(true)
  })
})

describe("widget rows", () => {
  it("pairs small widgets and gives medium ones a row", () => {
    expect(widgetRows(["weather", "clock", "calendar", "batteries", "clock"])).toEqual([
      ["weather"],
      ["clock", "calendar"],
      ["batteries"],
      ["clock"],
    ])
  })
})
