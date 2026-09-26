import { useSettings } from "@newos/sdk/react"
import { Group, IconTile, Page, Row, Toggle } from "@newos/ui"
import { Moon } from "lucide-react"

export function FocusPage() {
  const [settings, update] = useSettings()
  const on = settings.notifications.doNotDisturb
  return (
    <Page>
      <Group footer="While Do Not Disturb is on, notification banners stay hidden and collect in Notification Center. Timers in the island and the assistant keep working. You can also switch it in Control Center.">
        <Row
          label="Do Not Disturb"
          description={on ? "On" : "Off"}
          icon={
            <IconTile color="#5e5ce6" size={28}>
              <Moon strokeWidth={2.2} />
            </IconTile>
          }
        >
          <Toggle
            label="Do Not Disturb"
            checked={on}
            onChange={(v) => void update({ notifications: { doNotDisturb: v } })}
          />
        </Row>
      </Group>
      <p className="settings-footnote">
        Schedules and per-app Focus filters are planned for a later release.
      </p>
    </Page>
  )
}
