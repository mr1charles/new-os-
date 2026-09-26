/**
 * Unit conversion for the Calculator: "5 km in miles", "100 f to c", "2 gb in mb".
 * Each unit is a factor to the category's base unit; temperature has its own formulas.
 */

export type Category =
  "length" | "area" | "volume" | "mass" | "speed" | "time" | "data" | "temperature"

interface Unit {
  category: Category
  /** Multiply by this to get the base unit (metre, m², litre, gram, m/s, second, byte). */
  factor: number
  names: string[]
  /** Display name. */
  label: string
}

const U = (category: Category, factor: number, label: string, ...names: string[]): Unit => ({
  category,
  factor,
  label,
  names: [label, ...names],
})

export const UNITS: Unit[] = [
  U("length", 1e-3, "mm", "millimeter", "millimeters", "millimetre", "millimetres"),
  U("length", 1e-2, "cm", "centimeter", "centimeters", "centimetre", "centimetres"),
  U("length", 1, "m", "meter", "meters", "metre", "metres"),
  U("length", 1e3, "km", "kilometer", "kilometers", "kilometre", "kilometres"),
  U("length", 0.0254, "in", "inch", "inches", '"'),
  U("length", 0.3048, "ft", "foot", "feet", "'"),
  U("length", 0.9144, "yd", "yard", "yards"),
  U("length", 1609.344, "mi", "mile", "miles"),
  U("length", 1852, "nmi", "nautical mile", "nautical miles"),
  U(
    "area",
    1,
    "m²",
    "m2",
    "sq m",
    "square meter",
    "square meters",
    "square metre",
    "square metres",
  ),
  U("area", 1e6, "km²", "km2", "sq km", "square kilometer", "square kilometers"),
  U("area", 0.09290304, "ft²", "ft2", "sq ft", "square foot", "square feet"),
  U("area", 4046.8564224, "acre", "acres"),
  U("area", 1e4, "ha", "hectare", "hectares"),
  U("volume", 1e-3, "ml", "milliliter", "milliliters", "millilitre", "millilitres"),
  U("volume", 1, "l", "liter", "liters", "litre", "litres"),
  U("volume", 3.785411784, "gal", "gallon", "gallons"),
  U("volume", 0.946352946, "qt", "quart", "quarts"),
  U("volume", 0.473176473, "pt", "pint", "pints"),
  U("volume", 0.2365882365, "cup", "cups"),
  U("volume", 0.0295735295625, "fl oz", "fluid ounce", "fluid ounces", "floz"),
  U("volume", 0.01478676478125, "tbsp", "tablespoon", "tablespoons"),
  U("volume", 0.00492892159375, "tsp", "teaspoon", "teaspoons"),
  U("mass", 1e-3, "mg", "milligram", "milligrams"),
  U("mass", 1, "g", "gram", "grams"),
  U("mass", 1e3, "kg", "kilogram", "kilograms", "kilo", "kilos"),
  U("mass", 1e6, "t", "tonne", "tonnes", "metric ton"),
  U("mass", 28.349523125, "oz", "ounce", "ounces"),
  U("mass", 453.59237, "lb", "lbs", "pound", "pounds"),
  U("mass", 6350.29318, "st", "stone", "stones"),
  U("speed", 1, "m/s", "meters per second", "mps"),
  U("speed", 1000 / 3600, "km/h", "kph", "kmh", "kilometers per hour"),
  U("speed", 1609.344 / 3600, "mph", "miles per hour"),
  U("speed", 1852 / 3600, "kn", "knot", "knots"),
  U("time", 1e-3, "ms", "millisecond", "milliseconds"),
  U("time", 1, "s", "sec", "secs", "second", "seconds"),
  U("time", 60, "min", "mins", "minute", "minutes"),
  U("time", 3600, "h", "hr", "hrs", "hour", "hours"),
  U("time", 86400, "day", "days"),
  U("time", 604800, "week", "weeks"),
  U("time", 31557600, "year", "years", "yr"),
  U("data", 1 / 8, "bit", "bits"),
  U("data", 1, "B", "byte", "bytes"),
  U("data", 1e3, "KB", "kilobyte", "kilobytes"),
  U("data", 1e6, "MB", "megabyte", "megabytes"),
  U("data", 1e9, "GB", "gigabyte", "gigabytes"),
  U("data", 1e12, "TB", "terabyte", "terabytes"),
  U("data", 1024, "KiB", "kibibyte", "kibibytes"),
  U("data", 1024 ** 2, "MiB", "mebibyte", "mebibytes"),
  U("data", 1024 ** 3, "GiB", "gibibyte", "gibibytes"),
  U("temperature", 1, "°C", "c", "celsius", "°c", "degc", "degrees celsius"),
  U("temperature", 1, "°F", "f", "fahrenheit", "°f", "degf", "degrees fahrenheit"),
  U("temperature", 1, "K", "k", "kelvin", "kelvins"),
]

/** Case-sensitive only where it matters (MB vs mb both mean megabytes; "m" is metres). */
export function findUnit(name: string): Unit | undefined {
  const text = name.trim()
  return (
    UNITS.find((u) => u.names.includes(text)) ??
    UNITS.find((u) => u.names.some((n) => n.toLowerCase() === text.toLowerCase()))
  )
}

function toCelsius(value: number, unit: string): number {
  if (unit === "°F") return ((value - 32) * 5) / 9
  if (unit === "K") return value - 273.15
  return value
}

function fromCelsius(value: number, unit: string): number {
  if (unit === "°F") return (value * 9) / 5 + 32
  if (unit === "K") return value + 273.15
  return value
}

export interface Conversion {
  value: number
  from: string
  to: string
  result: number
}

export function convert(value: number, fromName: string, toName: string): Conversion | null {
  const from = findUnit(fromName)
  const to = findUnit(toName)
  if (!from || !to || from.category !== to.category) return null
  const result =
    from.category === "temperature"
      ? fromCelsius(toCelsius(value, from.label), to.label)
      : (value * from.factor) / to.factor
  return { value, from: from.label, to: to.label, result }
}

/** "5 km in miles", "3.5 lb to kg", "72°F in C". */
export function parseConversion(input: string): Conversion | null {
  const match =
    /^\s*(-?[\d.,]+(?:e[+-]?\d+)?)\s*(.+?)\s+(?:in|to|as|into|=)\s+(.+?)\s*\??\s*$/i.exec(input)
  if (!match) return null
  const value = Number(match[1]!.replace(/,/g, ""))
  if (!Number.isFinite(value)) return null
  return convert(value, match[2]!, match[3]!)
}
