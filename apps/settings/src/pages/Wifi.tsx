import { call, type WifiNetwork } from "@newos/sdk"
import { useAction, useCommand } from "@newos/sdk/react"
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  Group,
  Page,
  Row,
  Sheet,
  Spinner,
  TextField,
  Toggle,
  Value,
} from "@newos/ui"
import { Lock, WifiOff } from "lucide-react"
import { useState } from "react"
import { ActionError, LoadError, SignalIcon } from "../components/common"
import { isEnterprise, signalBars } from "../format"

function NetworkRow({
  network,
  onSelect,
  busy,
}: {
  network: WifiNetwork
  onSelect: () => void
  busy: boolean
}) {
  return (
    <Row
      label={network.ssid}
      icon={<SignalIcon bars={signalBars(network.signal)} />}
      description={isEnterprise(network.security) ? "Enterprise network" : undefined}
      onClick={onSelect}
    >
      {busy && <Spinner size={14} label="Connecting" />}
      {network.saved && !network.in_use && <Badge>Saved</Badge>}
      {network.security && <Lock size={13} className="settings-muted" aria-label="Secured" />}
    </Row>
  )
}

function DetailsSheet({
  network,
  onClose,
  onChanged,
}: {
  network: WifiNetwork
  onClose: () => void
  onChanged: () => void
}) {
  const { data: devices } = useCommand("net_devices")
  const device = devices?.find((d) => d.kind === "wifi" && d.connection === network.ssid)
  const action = useAction(async (kind: "disconnect" | "forget") => {
    await call(kind === "disconnect" ? "wifi_disconnect" : "wifi_forget", { ssid: network.ssid })
    onChanged()
    onClose()
  })
  return (
    <Sheet
      open
      onClose={onClose}
      title={network.ssid}
      width={440}
      actions={
        <>
          {network.saved && (
            <Button
              variant="destructive"
              disabled={action.pending}
              onClick={() => void action.run("forget")}
            >
              Forget This Network…
            </Button>
          )}
          <span className="settings-spacer" />
          {network.in_use && (
            <Button disabled={action.pending} onClick={() => void action.run("disconnect")}>
              Disconnect
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <ActionError error={action.error} />
      <div className="settings-details">
        <Row label="Signal">
          <Value>{network.signal}%</Value>
        </Row>
        <Row label="Security">
          <Value>{network.security || "None"}</Value>
        </Row>
        {device && (
          <>
            <Row label="IP Address">
              <Value>{device.ipv4.map((a) => a.split("/")[0]).join(", ") || "—"}</Value>
            </Row>
            <Row label="Router">
              <Value>{device.gateway || "—"}</Value>
            </Row>
            <Row label="DNS">
              <Value>{device.dns.join(", ") || "—"}</Value>
            </Row>
            <Row label="Wi-Fi Address">
              <Value>{device.mac}</Value>
            </Row>
          </>
        )}
      </div>
    </Sheet>
  )
}

function PasswordSheet({
  network,
  onClose,
  onJoined,
}: {
  network: WifiNetwork
  onClose: () => void
  onJoined: () => void
}) {
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const join = useAction(async () => {
    await call("wifi_connect", { ssid: network.ssid, password })
    onJoined()
    onClose()
  })
  // WPA passwords are 8-63 characters.
  const valid = password.length >= 8 && password.length <= 63
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Join “${network.ssid}”`}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || join.pending}
            onClick={() => void join.run()}
          >
            {join.pending ? "Joining…" : "Join"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void join.run()
        }}
      >
        <Field label="Password">
          {(id) => (
            <TextField
              id={id}
              type={show ? "text" : "password"}
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
          )}
        </Field>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.currentTarget.checked)}
          />{" "}
          Show password
        </label>
      </form>
      <ActionError error={join.error && "Couldn’t join. Check the password and try again."} />
    </Sheet>
  )
}

export function WifiPage() {
  const status = useCommand("wifi_status", undefined, { refreshMs: 5000 })
  const networks = useCommand(
    "wifi_networks",
    { rescan: false },
    { refreshMs: 15_000, enabled: status.data?.enabled ?? true },
  )
  const [scanning, setScanning] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [passwordFor, setPasswordFor] = useState<WifiNetwork | null>(null)
  const [detailsFor, setDetailsFor] = useState<WifiNetwork | null>(null)
  const [enterprise, setEnterprise] = useState<string | null>(null)

  const refresh = () => Promise.all([status.reload(), networks.reload()])
  const toggle = useAction(async (enabled: boolean) => {
    await call("wifi_set_enabled", { enabled })
    await refresh()
  })
  const connect = useAction(async (network: WifiNetwork) => {
    setJoining(network.ssid)
    try {
      await call("wifi_connect", { ssid: network.ssid })
      await refresh()
    } finally {
      setJoining(null)
    }
  })

  const scan = async () => {
    setScanning(true)
    try {
      await call("wifi_networks", { rescan: true })
      await networks.reload()
    } catch {
      // The periodic refresh reports errors.
    } finally {
      setScanning(false)
    }
  }

  const select = (network: WifiNetwork) => {
    if (network.in_use) setDetailsFor(network)
    else if (isEnterprise(network.security) && !network.saved) setEnterprise(network.ssid)
    else if (network.security && !network.saved) setPasswordFor(network)
    else void connect.run(network)
  }

  if (status.error)
    return (
      <Page>
        <LoadError error={status.error} retry={() => void status.reload()} />
      </Page>
    )
  if (!status.data) return <Page>{null}</Page>

  const enabled = status.data.enabled
  const list = networks.data ?? []
  const current = list.find((n) => n.in_use)
  const others = list.filter((n) => !n.in_use)

  return (
    <Page>
      <Group>
        <Row label="Wi-Fi">
          <Toggle
            label="Wi-Fi"
            checked={enabled}
            disabled={toggle.pending}
            onChange={(v) => void toggle.run(v)}
          />
        </Row>
        {enabled && current && (
          <Row
            label={current.ssid}
            description="Connected"
            icon={<SignalIcon bars={signalBars(current.signal)} />}
          >
            {current.security && <Lock size={13} className="settings-muted" aria-label="Secured" />}
            <Button size="small" onClick={() => setDetailsFor(current)}>
              Details…
            </Button>
          </Row>
        )}
      </Group>
      <ActionError error={toggle.error ?? connect.error} />
      {enterprise && (
        <Callout
          tone="warning"
          action={
            <Button size="small" onClick={() => setEnterprise(null)}>
              OK
            </Button>
          }
        >
          “{enterprise}” is an enterprise (802.1X) network. Joining it needs a username and
          certificates, which Settings can’t set up yet. Run <code>nmtui</code> in Terminal to join
          it.
        </Callout>
      )}
      {enabled ? (
        <Group
          title="Other Networks"
          titleAccessory={
            <Button size="small" disabled={scanning} onClick={() => void scan()}>
              {scanning ? <Spinner size={12} label="Scanning" /> : null}
              {scanning ? "Scanning…" : "Scan"}
            </Button>
          }
        >
          {networks.error ? (
            <LoadError error={networks.error} retry={() => void networks.reload()} />
          ) : others.length === 0 ? (
            <EmptyState title={networks.loading ? "Looking for networks…" : "No networks found"} />
          ) : (
            others.map((n) => (
              <NetworkRow
                key={n.ssid}
                network={n}
                busy={joining === n.ssid}
                onSelect={() => select(n)}
              />
            ))
          )}
        </Group>
      ) : (
        <EmptyState icon={<WifiOff size={36} />} title="Wi-Fi is off">
          Turn it on to see networks nearby.
        </EmptyState>
      )}
      {passwordFor && (
        <PasswordSheet
          network={passwordFor}
          onClose={() => setPasswordFor(null)}
          onJoined={() => void refresh()}
        />
      )}
      {detailsFor && (
        <DetailsSheet
          network={detailsFor}
          onClose={() => setDetailsFor(null)}
          onChanged={() => void refresh()}
        />
      )}
    </Page>
  )
}
