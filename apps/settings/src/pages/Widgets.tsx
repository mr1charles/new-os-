import type { WidgetSide } from "@helixos/sdk"
import { useSettings } from "@helixos/sdk/react"
import { Button, Group, Page, Row, SegmentedControl, TextField, Toggle } from "@helixos/ui"
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { useEffect, useState } from "react"

const KINDS: { id: string; name: string; description: string }[] = [
  { id: "weather", name: "Weather", description: "Now and the next hours" },
  { id: "batteries", name: "Batteries", description: "This computer and connected headphones" },
  { id: "clock", name: "Clock", description: "An analog clock" },
  { id: "calendar", name: "Calendar", description: "This month" },
]
const nameOf = (id: string) => KINDS.find((k) => k.id === id)?.name ?? id

/** Desktop widgets: which ones, in what order, which side, and the weather's city. */
export function WidgetsPage() {
  const [settings, update] = useSettings()
  const w = settings.widgets
  const [city, setCity] = useState(w.city)
  useEffect(() => setCity(w.city), [w.city])
  const items = w.items.filter((i) => KINDS.some((k) => k.id === i))
  const setItems = (next: string[]) => void update({ widgets: { items: next } })
  const move = (index: number, by: number) => {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    setItems(next)
  }
  const missing = KINDS.filter((k) => !items.includes(k.id))

  return (
    <Page>
      <Group footer="Widgets sit on the desktop behind your windows. Right-click the desktop and choose Edit Widgets to change them there.">
        <Row label="Show widgets on the desktop">
          <Toggle
            label="Show widgets on the desktop"
            checked={w.show}
            onChange={(show) => void update({ widgets: { show } })}
          />
        </Row>
        <Row label="Side">
          <SegmentedControl<WidgetSide>
            label="Side"
            value={w.side}
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ]}
            onChange={(side) => void update({ widgets: { side } })}
          />
        </Row>
      </Group>
      <Group title="On the desktop">
        {items.length === 0 && <Row label="No widgets" />}
        {items.map((id, i) => (
          <Row key={id} label={nameOf(id)}>
            <button
              type="button"
              className="nx-icon-button"
              aria-label={`Move ${nameOf(id)} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              className="nx-icon-button"
              aria-label={`Move ${nameOf(id)} down`}
              disabled={i === items.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className="nx-icon-button"
              aria-label={`Remove ${nameOf(id)}`}
              onClick={() => setItems(items.filter((x) => x !== id))}
            >
              <X size={14} />
            </button>
          </Row>
        ))}
      </Group>
      {missing.length > 0 && (
        <Group title="Add">
          {missing.map((k) => (
            <Row key={k.id} label={k.name} description={k.description}>
              <Button size="small" onClick={() => setItems([...items, k.id])}>
                <Plus size={12} /> Add
              </Button>
            </Row>
          ))}
        </Group>
      )}
      <Group
        title="Weather"
        footer="Forecasts come from Open-Meteo. Only the city name and its location are sent."
      >
        <Row label="City">
          <form
            className="settings-inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              void update({ widgets: { city: city.trim() } })
            }}
          >
            <TextField
              aria-label="City"
              placeholder="London"
              value={city}
              onChange={(e) => setCity(e.currentTarget.value)}
              onBlur={() =>
                city.trim() !== w.city && void update({ widgets: { city: city.trim() } })
              }
            />
          </form>
        </Row>
        <Row label="Temperature">
          <SegmentedControl<"c" | "f">
            label="Temperature unit"
            value={w.fahrenheit ? "f" : "c"}
            options={[
              { value: "c", label: "°C" },
              { value: "f", label: "°F" },
            ]}
            onChange={(u) => void update({ widgets: { fahrenheit: u === "f" } })}
          />
        </Row>
      </Group>
    </Page>
  )
}
