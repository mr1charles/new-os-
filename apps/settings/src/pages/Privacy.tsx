import { assistant, type AssistantSettings, type Fact } from "@newos/sdk"
import { useAction, useCommand } from "@newos/sdk/react"
import { EmptyState, Group, Page, Row, Toggle } from "@newos/ui"
import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { ActionError } from "../components/common"

export function PrivacyPage() {
  const config = useCommand("assistant_settings_read")
  const [facts, setFacts] = useState<Fact[] | null>(null)
  const [factsError, setFactsError] = useState<string | null>(null)

  const loadFacts = () =>
    assistant
      .facts()
      .then((f) => {
        setFacts(f)
        setFactsError(null)
      })
      .catch((e: unknown) => setFactsError(e instanceof Error ? e.message : String(e)))
  useEffect(() => {
    void loadFacts()
  }, [])

  const set = useAction(async (field: keyof AssistantSettings, value: boolean) => {
    await assistant.settings.set(field, value)
    await config.reload()
    await assistant.restart().catch(() => {})
  })
  const forget = useAction(async (id: number) => {
    await assistant.deleteFact(id)
    await loadFacts()
  })

  const s = config.data
  return (
    <Page>
      <Group
        title="Assistant"
        footer="With the cloud model, your messages go to Anthropic to be answered. With the on-device model, nothing leaves this laptop."
      >
        <Row
          label="Share the active window"
          description="Send the focused app’s name and window title with each request, so “this” means what you’re looking at."
        >
          <Toggle
            label="Share the active window"
            checked={s?.share_window_title ?? true}
            disabled={!s}
            onChange={(v) => void set.run("share_window_title", v)}
          />
        </Row>
        <Row
          label="Keep conversation history"
          description="Saved on this laptop in ~/.local/share/newos. Off keeps conversations in memory until you log out."
        >
          <Toggle
            label="Keep conversation history"
            checked={s?.store_history ?? true}
            disabled={!s}
            onChange={(v) => void set.run("store_history", v)}
          />
        </Row>
      </Group>
      <ActionError error={set.error} />
      <Group
        title="What the Assistant Remembers"
        footer="Ask the assistant to remember something, or remove anything here."
      >
        {factsError ? (
          <EmptyState title="The assistant isn’t running">
            Start it to see what it remembers.
          </EmptyState>
        ) : facts === null ? (
          <EmptyState title="Loading…" />
        ) : facts.length === 0 ? (
          <EmptyState title="Nothing yet" />
        ) : (
          facts.map((f) => (
            <Row
              key={f.id}
              label={f.text}
              description={new Date(f.created_at * 1000).toLocaleDateString()}
            >
              <button
                type="button"
                className="nx-icon-button"
                aria-label={`Forget “${f.text}”`}
                onClick={() => void forget.run(f.id)}
              >
                <X size={14} />
              </button>
            </Row>
          ))
        )}
      </Group>
      <ActionError error={forget.error} />
      <Group
        title="Face Unlock"
        footer="The built-in camera has no infrared sensor, so a photo can fool face unlock. It is a convenience, never used for administrator actions."
      >
        <Row label="Face unlock" description="Set up in Users & Spaces (coming with Dual Space).">
          <Toggle label="Face unlock" checked={false} disabled onChange={() => {}} />
        </Row>
      </Group>
    </Page>
  )
}
