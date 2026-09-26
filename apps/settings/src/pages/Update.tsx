import { call } from "@newos/sdk"
import { useAction, useCommand } from "@newos/sdk/react"
import { Badge, Button, EmptyState, Group, Page, Row, Spinner, Value } from "@newos/ui"
import { CheckCircle2 } from "lucide-react"
import { ActionError, LoadError } from "../components/common"

export function UpdatePage() {
  const updates = useCommand("updates")
  const run = useAction(() => call("update_in_terminal"))
  const list = updates.data ?? []
  const system = list.filter((u) => u.source === "system")
  const flatpak = list.filter((u) => u.source === "flatpak")
  const kernel = system.some((u) => /^linux(-zen|-lts|-cachyos)?$/.test(u.name))

  return (
    <Page>
      {updates.error ? (
        <LoadError error={updates.error} retry={() => void updates.reload()} />
      ) : updates.loading && !updates.data ? (
        <Group>
          <EmptyState icon={<Spinner size={24} />} title="Checking for updates…" />
        </Group>
      ) : list.length === 0 ? (
        <Group>
          <EmptyState
            icon={<CheckCircle2 size={36} className="settings-success" />}
            title="Everything is up to date"
          >
            <Button size="small" onClick={() => void updates.reload()}>
              Check Again
            </Button>
          </EmptyState>
        </Group>
      ) : (
        <>
          <Group
            title={`${list.length} update${list.length === 1 ? "" : "s"} available`}
            titleAccessory={
              <>
                <Button
                  size="small"
                  onClick={() => void updates.reload()}
                  disabled={updates.loading}
                >
                  Check Again
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  onClick={() => void run.run()}
                  disabled={run.pending}
                >
                  Update Now…
                </Button>
              </>
            }
            footer={
              <>
                Update Now opens Terminal and asks for your password.
                {kernel && " A new kernel is included, so restart afterwards."}
              </>
            }
          >
            {system.map((u) => (
              <Row key={u.name} label={u.name}>
                <Value>
                  {u.from} → {u.to}
                </Value>
              </Row>
            ))}
            {flatpak.map((u) => (
              <Row key={u.name} label={u.name}>
                <Badge>App</Badge>
                <Value>{u.to}</Value>
              </Row>
            ))}
          </Group>
        </>
      )}
      <ActionError error={run.error} />
    </Page>
  )
}
