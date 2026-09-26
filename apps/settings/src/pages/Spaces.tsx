import { useCommand } from "@newos/sdk/react"
import { Badge, Button, Callout, Group, Page, Row, Value } from "@newos/ui"
import { Fingerprint, Plus } from "lucide-react"
import { fingerName } from "../format"

export function SpacesPage() {
  const account = useCommand("account")
  const prints = useCommand("fingerprints")
  const a = account.data
  const fp = prints.data
  return (
    <Page>
      {a && (
        <Group>
          <Row
            label={<span className="settings-account-title">{a.full_name}</span>}
            description={`${a.username} · ${a.home}`}
            icon={
              <span className="settings-avatar settings-avatar--large" aria-hidden="true">
                {a.full_name.charAt(0).toUpperCase()}
              </span>
            }
          >
            {a.admin && <Badge tone="accent">Admin</Badge>}
          </Row>
        </Group>
      )}
      <Group
        title="Spaces"
        titleAccessory={
          <Button size="small" disabled>
            <Plus size={12} /> Add Space…
          </Button>
        }
        footer="Each space is a separate account with its own apps, files, and look. At login, the password (or fingerprint) you use decides which space opens."
      >
        {a && (
          <Row label={a.full_name} description="The space you’re in">
            <Badge tone="success">Current</Badge>
          </Row>
        )}
      </Group>
      <Callout>
        Dual Space arrives with the next milestone: creating spaces, the login screen, and switching
        from the lock screen.
      </Callout>
      <Group
        title="Fingerprints"
        footer={
          fp?.available
            ? `Reader: ${fp.device}`
            : "No fingerprint reader was found. Spaces still work with passwords."
        }
      >
        {fp?.available ? (
          fp.enrolled.length > 0 ? (
            fp.enrolled.map((f) => (
              <Row
                key={f}
                label={fingerName(f)}
                icon={<Fingerprint size={18} className="settings-muted" />}
              >
                <Value>Enrolled</Value>
              </Row>
            ))
          ) : (
            <Row label="No fingerprints enrolled" />
          )
        ) : (
          <Row label={prints.loading ? "Checking for a reader…" : "Not available"} />
        )}
        {fp?.available && (
          <Row label="">
            <Button size="small" disabled title="Enrollment comes with Dual Space">
              Add Fingerprint…
            </Button>
          </Row>
        )}
      </Group>
    </Page>
  )
}
