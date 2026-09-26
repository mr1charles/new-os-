import { assistant, type AssistantSettings } from "@helixos/sdk"
import { useAction, useCommand, useSettings } from "@helixos/sdk/react"
import {
  Badge,
  Button,
  Callout,
  Field,
  Group,
  Page,
  Row,
  SegmentedControl,
  Select,
  Sheet,
  TextField,
  Toggle,
  Value,
} from "@helixos/ui"
import { useEffect, useRef, useState } from "react"
import { ActionError, LoadError } from "../components/common"

const MODELS = [
  { value: "claude-opus-5", label: "Claude Opus 5 (default)" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 (faster, lower cost)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
  { value: "claude-fable-5-1", label: "Claude Fable 5.1 (most capable)" },
]

const EFFORT = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
] as const

const LOCAL_MODELS = ["qwen2.5:3b", "llama3.2:3b", "phi4-mini", "gemma3:4b"]

/** assistantd reads its config at start. Restart it once after a burst of changes. */
function useDebouncedRestart(onError: (message: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      assistant.restart().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
    }, 800)
  }
}

function KeySheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState("")
  const save = useAction(async () => {
    await assistant.key.store(key.trim())
    onSaved()
    onClose()
  })
  return (
    <Sheet
      open
      onClose={onClose}
      title="Anthropic API Key"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!key.trim() || save.pending}
            onClick={() => void save.run()}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        <Field
          label="API key"
          hint={
            <>
              Create one at console.anthropic.com. It is stored in your keyring (Secret Service),
              never in a plain file, and only the assistant reads it.
            </>
          }
        >
          {(id) => (
            <TextField
              id={id}
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
          )}
        </Field>
      </form>
      <ActionError error={save.error} />
    </Sheet>
  )
}

export function AssistantPage() {
  const status = useCommand(
    "assistant_request",
    { method: "GET", path: "/v1/status" },
    { refreshMs: 5000 },
  )
  const config = useCommand("assistant_settings_read")
  const hasKey = useCommand("assistant_key_status")
  const [, updateShell] = useSettings()
  const [editingKey, setEditingKey] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const restart = useDebouncedRestart(setRestartError)

  const set = useAction(
    async <K extends keyof AssistantSettings>(field: K, value: AssistantSettings[K]) => {
      await assistant.settings.set(field, value)
      await config.reload()
      restart()
    },
  )
  const clearKey = useAction(async () => {
    await assistant.key.clear()
    await hasKey.reload()
    restart()
  })

  const s = config.data
  const st = status.data as Awaited<ReturnType<typeof assistant.status>> | undefined
  if (config.error)
    return (
      <Page>
        <LoadError error={config.error} retry={() => void config.reload()} />
      </Page>
    )
  if (!s) return <Page>{null}</Page>

  const active = st?.active
  const saveName = () => {
    const next = (name ?? s.name).trim()
    setName(null)
    if (!next || next === s.name) return
    void set.run("name", next)
    void updateShell({ assistant: { name: next } })
  }

  return (
    <Page>
      {status.error ? (
        <Callout tone="warning">
          The assistant isn’t running. It starts with your session; you can start it now with{" "}
          <code>systemctl --user start helixos-assistantd</code>.
        </Callout>
      ) : (
        st && (
          <Group>
            <Row
              label={st.assistant_name}
              description={
                active === "cloud"
                  ? `Using ${st.cloud.model} in the cloud`
                  : active === "local"
                    ? `Using ${st.local.model} on this laptop`
                    : "No model available"
              }
            >
              <Badge tone={active === "none" ? "danger" : "success"}>
                {active === "cloud" ? "Cloud" : active === "local" ? "On-device" : "Unavailable"}
              </Badge>
              {!st.online && <Badge tone="warning">Offline</Badge>}
            </Row>
          </Group>
        )
      )}
      <ActionError error={set.error ?? restartError} />

      <Group>
        <Row
          label="Name"
          htmlFor="assistant-name"
          description="What the assistant calls itself, in the island and the panel."
        >
          <TextField
            id="assistant-name"
            className="settings-short-field"
            value={name ?? s.name}
            maxLength={32}
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Row>
        <Row
          label="Model"
          description={
            s.mode === "auto"
              ? "Claude when you’re online and a key is set; the on-device model otherwise."
              : s.mode === "cloud"
                ? "Always Claude. Needs internet and an API key."
                : "Always on this laptop. Nothing leaves it."
          }
        >
          <SegmentedControl
            label="Where the assistant runs"
            value={s.mode}
            options={[
              { value: "auto", label: "Automatic" },
              { value: "cloud", label: "Cloud" },
              { value: "local", label: "On-device" },
            ]}
            onChange={(v) => void set.run("mode", v)}
          />
        </Row>
      </Group>

      <Group title="Claude (cloud)">
        <Row label="API key" description={hasKey.data ? "Saved in your keyring" : "Not set"}>
          {hasKey.data && (
            <Button
              variant="destructive"
              size="small"
              disabled={clearKey.pending}
              onClick={() => void clearKey.run()}
            >
              Remove
            </Button>
          )}
          <Button size="small" onClick={() => setEditingKey(true)}>
            {hasKey.data ? "Change…" : "Add Key…"}
          </Button>
        </Row>
        {st?.cloud.key_source === "environment" && (
          <Row label="">
            <Value>ANTHROPIC_API_KEY in the environment takes priority over the keyring.</Value>
          </Row>
        )}
        <Row label="Model">
          <Select
            aria-label="Cloud model"
            value={s.cloud_model}
            options={
              MODELS.some((m) => m.value === s.cloud_model)
                ? MODELS
                : [{ value: s.cloud_model, label: s.cloud_model }, ...MODELS]
            }
            onChange={(v) => void set.run("cloud_model", v)}
          />
        </Row>
        <Row
          label="Thinking effort"
          description="Higher effort answers harder questions better but takes longer and costs more."
        >
          <Select
            aria-label="Thinking effort"
            value={s.effort}
            options={[...EFFORT]}
            onChange={(v) => void set.run("effort", v)}
          />
        </Row>
      </Group>
      <ActionError error={clearKey.error} />

      <Group
        title="On-device (Ollama)"
        footer={
          st && !st.local.available ? (
            <>
              Ollama isn’t running or the model isn’t installed. Install it with{" "}
              <code>ollama pull {s.local_model}</code>.
            </>
          ) : (
            "Small models run well on this laptop’s CPU. Replies are slower than the cloud and less capable."
          )
        }
      >
        <Row label="Model">
          <Select
            aria-label="On-device model"
            value={s.local_model}
            options={(LOCAL_MODELS.includes(s.local_model)
              ? LOCAL_MODELS
              : [s.local_model, ...LOCAL_MODELS]
            ).map((m) => ({ value: m, label: m }))}
            onChange={(v) => void set.run("local_model", v)}
          />
          {st && (
            <Badge tone={st.local.available ? "success" : "warning"}>
              {st.local.available ? "Ready" : "Not installed"}
            </Badge>
          )}
        </Row>
      </Group>

      <Group
        title="Permissions"
        footer="Commands and moving files to the Trash always ask first, in the island."
      >
        <Row
          label="Allow running commands"
          description="The assistant can propose shell commands for you to approve."
        >
          <Toggle
            label="Allow running commands"
            checked={s.allow_shell}
            onChange={(v) => void set.run("allow_shell", v)}
          />
        </Row>
      </Group>
      <p className="settings-footnote">
        History and what the assistant can see are in Privacy & Security.
      </p>
      {editingKey && (
        <KeySheet
          onClose={() => setEditingKey(false)}
          onSaved={() => {
            void hasKey.reload()
            restart()
          }}
        />
      )}
    </Page>
  )
}
