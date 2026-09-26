import { useSettings } from "@helixos/sdk/react"
import { Group, Page, Row, Toggle } from "@helixos/ui"

export function NotificationsPage() {
  const [settings, update] = useSettings()
  const island = settings.island
  const set = (key: keyof typeof island) => (value: boolean) =>
    void update({ island: { [key]: value } })
  return (
    <Page>
      <Group
        title="Dynamic Island"
        footer="Choose what the island at the top of the screen shows as it happens."
      >
        <Row
          label="Notifications"
          description="Banners grow out of the island, then move to Notification Center."
        >
          <Toggle
            label="Notifications in the island"
            checked={island.notifications}
            onChange={set("notifications")}
          />
        </Row>
        <Row label="Now Playing" description="Album art and progress while music or video plays.">
          <Toggle
            label="Now Playing in the island"
            checked={island.media}
            onChange={set("media")}
          />
        </Row>
        <Row label="Volume and Brightness" description="Shows the level when you press the keys.">
          <Toggle
            label="Volume and brightness in the island"
            checked={island.osd}
            onChange={set("osd")}
          />
        </Row>
        <Row label="Battery" description="Charging and low battery.">
          <Toggle
            label="Battery in the island"
            checked={island.battery}
            onChange={set("battery")}
          />
        </Row>
      </Group>
      <Group>
        <Row
          label="Do Not Disturb"
          description="Silence banners. Notifications still collect in Notification Center."
        >
          <Toggle
            label="Do Not Disturb"
            checked={settings.notifications.doNotDisturb}
            onChange={(v) => void update({ notifications: { doNotDisturb: v } })}
          />
        </Row>
      </Group>
    </Page>
  )
}
