import { call } from "@newos/sdk"
import { useAction, useCommand } from "@newos/sdk/react"
import { Badge, EmptyState, Group, Page, Row, Toggle, Value } from "@newos/ui"
import { Cable, Plane, Wifi } from "lucide-react"
import { ActionError, LoadError } from "../components/common"

const KIND_LABELS: Record<string, string> = {
  wifi: "Wi-Fi",
  ethernet: "Ethernet",
  bridge: "Bridge",
  tun: "VPN",
  wireguard: "WireGuard",
}

export function NetworkPage() {
  const devices = useCommand("net_devices", undefined, { refreshMs: 5000 })
  const airplane = useCommand("airplane_get", undefined, { refreshMs: 5000 })
  const toggle = useAction(async (enabled: boolean) => {
    await call("airplane_set", { enabled })
    await Promise.all([airplane.reload(), devices.reload()])
  })

  return (
    <Page>
      <Group footer="Airplane Mode turns off Wi-Fi and Bluetooth.">
        <Row label="Airplane Mode" icon={<Plane size={18} className="settings-muted" />}>
          <Toggle
            label="Airplane Mode"
            checked={airplane.data ?? false}
            disabled={airplane.data === undefined || toggle.pending}
            onChange={(v) => void toggle.run(v)}
          />
        </Row>
      </Group>
      <ActionError error={toggle.error} />
      {devices.error ? (
        <LoadError error={devices.error} retry={() => void devices.reload()} />
      ) : (devices.data ?? []).length === 0 ? (
        <Group title="Connections">
          <EmptyState title={devices.loading ? "Loading…" : "No network connections"} />
        </Group>
      ) : (
        (devices.data ?? []).map((d) => {
          const Icon = d.kind === "wifi" ? Wifi : Cable
          const connected = d.state.startsWith("connected")
          return (
            <Group key={d.device} title={`${KIND_LABELS[d.kind] ?? d.kind} (${d.device})`}>
              <Row
                label={d.connection || "Not connected"}
                icon={<Icon size={18} className="settings-muted" />}
              >
                <Badge tone={connected ? "success" : "neutral"}>
                  {connected ? "Connected" : d.state}
                </Badge>
              </Row>
              {d.ipv4.length > 0 && (
                <Row label="IP Address">
                  <Value>{d.ipv4.join(", ")}</Value>
                </Row>
              )}
              {d.gateway && (
                <Row label="Router">
                  <Value>{d.gateway}</Value>
                </Row>
              )}
              {d.dns.length > 0 && (
                <Row label="DNS Servers">
                  <Value>{d.dns.join(", ")}</Value>
                </Row>
              )}
              {d.mac && (
                <Row label="Hardware Address">
                  <Value>{d.mac}</Value>
                </Row>
              )}
            </Group>
          )
        })
      )}
      <p className="settings-footnote">
        VPNs, proxies, and static addresses: run <code>nmtui</code> in Terminal. They come to
        Settings in a later release.
      </p>
    </Page>
  )
}
