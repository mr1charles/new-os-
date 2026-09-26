import {
  assistant,
  diffConfig,
  parseCustomization,
  patchConfig,
  PRESETS,
  customizeInput,
  type Change,
  type Settings,
} from "@helixos/sdk"
import { useSettings } from "@helixos/sdk/react"
import { Button, Callout, Group, Page, Row, TextField } from "@helixos/ui"
import { Sparkles, Undo2 } from "lucide-react"
import { useState } from "react"

const EXAMPLES = [
  "Make it look more like Windows",
  "Make everything feel faster",
  "Tile my windows and put the dock on the left",
  "Softer, rounder, more colorful",
]

const LABELS: Record<string, string> = {
  "appearance.theme": "Appearance",
  "appearance.accent": "Accent color",
  "appearance.reduceTransparency": "Reduce transparency",
  "dock.position": "Dock position",
  "dock.style": "Dock style",
  "dock.iconSize": "Dock icon size",
  "dock.magnification": "Magnification",
  "dock.showRecents": "Recent apps in the Dock",
  "bar.position": "Menu bar position",
  "windows.layout": "Window layout",
  "windows.rounding": "Corner roundness",
  "windows.gaps": "Space between windows",
  "windows.blur": "Blur",
  "windows.animations": "Animations",
  "windows.controls": "Window buttons",
}

function describe(change: Change) {
  const label = LABELS[change.path] ?? change.path
  return `${label}: ${String(change.from)} → ${String(change.to)}`
}

/**
 * Change the whole look at once: built-in looks, or a request in plain words that the
 * assistant turns into settings. Everything applies immediately and can be undone.
 */
export function CustomizePage() {
  const [settings, update] = useSettings()
  const [request, setRequest] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    summary: string
    changes: Change[]
    before: Settings
  } | null>(null)

  const apply = async (next: Settings, summary: string) => {
    const changes = diffConfig(settings, next)
    const before = settings
    await update(next)
    setResult({ summary, changes, before })
  }

  const ask = async (text: string) => {
    const wanted = text.trim()
    if (!wanted) return
    setBusy(true)
    setError(null)
    try {
      const reply = await assistant.complete("customize", customizeInput(wanted, settings))
      const parsed = parseCustomization(reply, settings)
      if (!parsed)
        throw new Error("The assistant didn’t suggest any changes. Try saying it another way.")
      if (parsed.changes.length === 0) {
        setResult({
          summary: parsed.summary || "Nothing needed to change.",
          changes: [],
          before: settings,
        })
      } else {
        await apply(parsed.config, parsed.summary || "Done.")
      }
      setRequest("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <Group
        title="Ask the assistant"
        footer="Describe how you want HelixOS to look or behave. Changes apply right away, and you can undo them."
      >
        <form
          className="settings-customize"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(request)
          }}
        >
          <TextField
            aria-label="What should change?"
            placeholder="Make it look more like Windows…"
            value={request}
            disabled={busy}
            onChange={(e) => setRequest(e.currentTarget.value)}
          />
          <Button variant="primary" type="submit" disabled={busy || !request.trim()}>
            <Sparkles size={13} /> {busy ? "Working…" : "Change"}
          </Button>
        </form>
        <div className="settings-chips">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="settings-chip"
              disabled={busy}
              onClick={() => void ask(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </Group>
      {error && <Callout tone="danger">{error}</Callout>}
      {result && (
        <Callout tone="info">
          <div className="settings-customize-result">
            <strong>{result.summary}</strong>
            {result.changes.length > 0 && (
              <ul>
                {result.changes.map((c) => (
                  <li key={c.path}>{describe(c)}</li>
                ))}
              </ul>
            )}
            {result.changes.length > 0 && (
              <Button
                size="small"
                onClick={() => {
                  void update(result.before)
                  setResult(null)
                }}
              >
                <Undo2 size={12} /> Undo
              </Button>
            )}
          </div>
        </Callout>
      )}
      <Group title="Looks" footer="A starting point; change anything afterwards.">
        {PRESETS.map((preset) => (
          <Row key={preset.id} label={preset.name} description={preset.description}>
            <Button
              size="small"
              onClick={() =>
                void apply(
                  patchConfig(settings, preset.patch),
                  `Switched to the ${preset.name} look.`,
                )
              }
            >
              Use
            </Button>
          </Row>
        ))}
      </Group>
    </Page>
  )
}
