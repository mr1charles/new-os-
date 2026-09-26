import { call, type PowerProfile } from "@newos/sdk"
import { useAction, useCommand, useSettings } from "@newos/sdk/react"
import { Badge, EmptyState, Group, Page, Row, SegmentedControl, Toggle, Value } from "@newos/ui"
import { BatteryWarning } from "lucide-react"
import { ActionError, LoadError } from "../components/common"

const PROFILES: { value: PowerProfile; label: string; description: string }[] = [
  {
    value: "power-saver",
    label: "Low Power",
    description: "Longer battery life, slower performance.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Good performance with reasonable battery life.",
  },
  {
    value: "performance",
    label: "High Power",
    description: "The fastest the laptop goes. Uses more battery and runs warmer.",
  },
]

export function BatteryPage() {
  const battery = useCommand("battery_details", undefined, { refreshMs: 10_000 })
  const profiles = useCommand("power_profiles")
  const [settings, update] = useSettings()
  const setProfile = useAction(async (profile: PowerProfile) => {
    await call("power_profile_set", { profile })
    await profiles.reload()
  })

  const b = battery.data
  const active = profiles.data?.active
  const available = PROFILES.filter((p) => profiles.data?.available.includes(p.value))
  const health = b?.health ?? null

  return (
    <Page>
      {battery.error ? (
        <LoadError error={battery.error} retry={() => void battery.reload()} />
      ) : b === null ? (
        <Group>
          <EmptyState title="No battery" />
        </Group>
      ) : (
        <Group title="Battery">
          <Row label="Charge">
            <Value>{b?.percent ?? "—"}%</Value>
            {b && (
              <Badge tone={b.on_ac ? "success" : "neutral"}>
                {b.on_ac ? b.state || "Plugged In" : "On Battery"}
              </Badge>
            )}
          </Row>
          {health !== null && (
            <Row
              label="Battery health"
              description={
                health < 80
                  ? "The battery holds noticeably less charge than when it was new."
                  : undefined
              }
            >
              <Value>{health}%</Value>
              {health < 80 && (
                <BatteryWarning
                  size={16}
                  className="settings-warning"
                  aria-label="Reduced capacity"
                />
              )}
            </Row>
          )}
          {b?.cycle_count != null && (
            <Row label="Charge cycles">
              <Value>{b.cycle_count}</Value>
            </Row>
          )}
          {b?.power_watts != null && b.power_watts > 0.1 && (
            <Row label={b.on_ac ? "Charging at" : "Using"}>
              <Value>{b.power_watts.toFixed(1)} W</Value>
            </Row>
          )}
        </Group>
      )}
      {profiles.error ? (
        <LoadError error={profiles.error} />
      ) : (
        available.length > 0 && (
          <Group title="Energy Mode" footer={PROFILES.find((p) => p.value === active)?.description}>
            <Row label="Mode">
              <SegmentedControl
                label="Energy mode"
                value={active || "balanced"}
                options={available.map((p) => ({ value: p.value, label: p.label }))}
                onChange={(v) => void setProfile.run(v)}
                disabled={setProfile.pending}
              />
            </Row>
          </Group>
        )
      )}
      <ActionError error={setProfile.error} />
      <Group>
        <Row label="Show percentage in the menu bar">
          <Toggle
            label="Show percentage in the menu bar"
            checked={settings.bar.showBatteryPercent}
            onChange={(v) => void update({ bar: { showBatteryPercent: v } })}
          />
        </Row>
      </Group>
    </Page>
  )
}
