/**
 * First-run Setup: language and keyboard, the look, the assistant, and a web browser. Shown
 * full screen the first time HelixOS starts (`helixos-settings --setup`, launched by the shell
 * while settings `setup.done` is false). Every step applies as you continue, so leaving early
 * keeps what was chosen; "Set Up Later" finishes without asking the rest.
 */
import { accentColor, accentNames } from "@helixos/design-tokens"
import {
  assistant,
  call,
  inTauri,
  patchConfig,
  PRESETS,
  type Settings,
  type ThemePreference,
} from "@helixos/sdk"
import { useAppTheme, useSettings } from "@helixos/sdk/react"
import { Button, cx, TextField, Toggle } from "@helixos/ui"
import { Check, ChevronLeft, Cloud, Cpu, PowerOff, Sparkles } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import logo from "../../../../shell/assets/brand/helixos-logo.svg"
import {
  BROWSERS,
  greetings,
  KEYBOARDS,
  LANGUAGES,
  LOCAL_MODELS,
  looksLikeKey,
  matchLanguage,
  pinBrowser,
  type AssistantChoice,
  type Browser,
} from "./data"

const STEPS = ["hello", "language", "look", "assistant", "browser", "done"] as const
type Step = (typeof STEPS)[number]

async function closeWindow() {
  if (!inTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await getCurrentWindow().close()
}

function Hello({ onNext }: { onNext: () => void }) {
  const words = useMemo(greetings, [])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % words.length), 1800)
    return () => clearInterval(timer)
  }, [words.length])
  return (
    <div className="setup-hello">
      <img className="setup-hello__logo" src={logo} alt="" />
      <h1 key={index} className="setup-hello__word">
        {words[index]}
      </h1>
      <p className="setup-lead">Welcome to HelixOS. Let’s set up a few things.</p>
      <Button variant="primary" className="setup-big-button" onClick={onNext} autoFocus>
        Get Started
      </Button>
    </div>
  )
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="setup-section">
      <h2 className="setup-title">{title}</h2>
      {lead && <p className="setup-lead">{lead}</p>}
      <div className="setup-body">{children}</div>
    </div>
  )
}

function LanguageStep(props: {
  lang: string
  keyboard: string
  onLang: (lang: string, keyboard: string) => void
  onKeyboard: (keyboard: string) => void
}) {
  const [query, setQuery] = useState("")
  const shown = LANGUAGES.filter(
    (l) =>
      !query ||
      l.name.toLowerCase().includes(query.toLowerCase()) ||
      l.english.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <Section
      title="Language & Keyboard"
      lead="Apps use this language after you log out and back in. HelixOS’s own apps are in English for now."
    >
      <TextField
        className="setup-search"
        placeholder="Search languages"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        aria-label="Search languages"
      />
      <div className="setup-list" role="listbox" aria-label="Language">
        {shown.map((l) => (
          <button
            key={l.lang}
            type="button"
            role="option"
            aria-selected={props.lang === l.lang}
            className={cx(
              "setup-list__item",
              props.lang === l.lang && "setup-list__item--selected",
            )}
            onClick={() => props.onLang(l.lang, l.keyboard)}
          >
            <span>{l.name}</span>
            {l.name !== l.english && <span className="setup-dim">{l.english}</span>}
            {props.lang === l.lang && <Check size={16} className="setup-check" />}
          </button>
        ))}
      </div>
      <label className="setup-field">
        <span>Keyboard</span>
        <select
          className="nx-select"
          value={props.keyboard}
          onChange={(e) => props.onKeyboard(e.currentTarget.value)}
        >
          {KEYBOARDS.map((k) => (
            <option key={k.layout} value={k.layout}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
    </Section>
  )
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
]

function LookStep({ settings, update }: { settings: Settings; update: (s: Settings) => void }) {
  const theme = settings.appearance.theme
  return (
    <Section title="Choose Your Look" lead="You can change all of this later in Settings.">
      <div className="setup-cards setup-cards--three" role="radiogroup" aria-label="Appearance">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            className={cx("setup-card", theme === t.value && "setup-card--selected")}
            onClick={() => update(patchConfig(settings, { appearance: { theme: t.value } }))}
          >
            <span className={cx("setup-theme", `setup-theme--${t.value}`)} aria-hidden="true">
              <span className="setup-theme__window" />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="setup-swatches" role="radiogroup" aria-label="Accent color">
        {accentNames.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={settings.appearance.accent === name}
            aria-label={name}
            title={name.charAt(0).toUpperCase() + name.slice(1)}
            className={cx(
              "setup-swatch",
              settings.appearance.accent === name && "setup-swatch--selected",
            )}
            style={{ background: accentColor(name, "dark") }}
            onClick={() => update(patchConfig(settings, { appearance: { accent: name } }))}
          />
        ))}
      </div>
      <div className="setup-cards" role="radiogroup" aria-label="Look">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="setup-card setup-card--wide"
            onClick={() => update(patchConfig(settings, p.patch))}
          >
            <span className={cx("setup-look", `setup-look--${p.id}`)} aria-hidden="true">
              <span className="setup-look__bar" />
              <span className="setup-look__window" />
              <span className="setup-look__dock" />
            </span>
            <span className="setup-card__name">{p.name}</span>
            <span className="setup-dim">{p.description}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

function AssistantStep(props: {
  choice: AssistantChoice
  setChoice: (c: AssistantChoice) => void
  apiKey: string
  setApiKey: (k: string) => void
  model: string
  setModel: (m: string) => void
  features: { memory: boolean; windowTitle: boolean; commands: boolean }
  setFeatures: (f: { memory: boolean; windowTitle: boolean; commands: boolean }) => void
}) {
  const options: { value: AssistantChoice; icon: ReactNode; title: string; body: string }[] = [
    {
      value: "cloud",
      icon: <Cloud size={22} />,
      title: "Claude, in the cloud",
      body: "The fastest and smartest. Needs an Anthropic API key and the internet.",
    },
    {
      value: "local",
      icon: <Cpu size={22} />,
      title: "On this computer",
      body: "Private and works offline. Slower on a laptop like this one.",
    },
    {
      value: "off",
      icon: <PowerOff size={22} />,
      title: "Off",
      body: "No assistant. You can turn it on later in Settings.",
    },
  ]
  const f = props.features
  return (
    <Section
      title="Your Assistant"
      lead="Ask questions, change settings, find files, and more with Alt+Space."
    >
      <div className="setup-cards setup-cards--three" role="radiogroup" aria-label="Assistant">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={props.choice === o.value}
            className={cx(
              "setup-card setup-card--option",
              props.choice === o.value && "setup-card--selected",
            )}
            onClick={() => props.setChoice(o.value)}
          >
            <span className="setup-card__icon">{o.icon}</span>
            <span className="setup-card__name">{o.title}</span>
            <span className="setup-dim">{o.body}</span>
          </button>
        ))}
      </div>
      {props.choice === "cloud" && (
        <label className="setup-field">
          <span>Anthropic API key</span>
          <TextField
            type="password"
            placeholder="sk-ant-…"
            value={props.apiKey}
            onChange={(e) => props.setApiKey(e.currentTarget.value)}
          />
          <span className="setup-dim">
            {props.apiKey && !looksLikeKey(props.apiKey)
              ? "That doesn’t look like an Anthropic key (it starts with sk-ant-)."
              : "Stored in your keyring. Get one at console.anthropic.com. You can skip this and add it later."}
          </span>
        </label>
      )}
      {props.choice === "local" && (
        <div className="setup-segment" role="radiogroup" aria-label="Model">
          {LOCAL_MODELS.map((m) => (
            <button
              key={m.model}
              type="button"
              role="radio"
              aria-checked={props.model === m.model}
              className={cx("setup-segment__item", props.model === m.model && "selected")}
              onClick={() => props.setModel(m.model)}
            >
              <strong>{m.name}</strong>
              <span className="setup-dim">{m.note}</span>
            </button>
          ))}
        </div>
      )}
      {props.choice !== "off" && (
        <div className="setup-toggles">
          <label className="setup-toggle">
            <span>
              Remember things you tell it
              <span className="setup-dim">Like your name or that you prefer Celsius.</span>
            </span>
            <Toggle
              label="Remember things you tell it"
              checked={f.memory}
              onChange={(v) => props.setFeatures({ ...f, memory: v })}
            />
          </label>
          <label className="setup-toggle">
            <span>
              Know which app you’re using
              <span className="setup-dim">Sends the window’s title with your question.</span>
            </span>
            <Toggle
              label="Know which app you’re using"
              checked={f.windowTitle}
              onChange={(v) => props.setFeatures({ ...f, windowTitle: v })}
            />
          </label>
          <label className="setup-toggle">
            <span>
              Run commands for you
              <span className="setup-dim">It always asks before running anything.</span>
            </span>
            <Toggle
              label="Run commands for you"
              checked={f.commands}
              onChange={(v) => props.setFeatures({ ...f, commands: v })}
            />
          </label>
        </div>
      )}
    </Section>
  )
}

function BrowserStep({ chosen, setChosen }: { chosen: string; setChosen: (id: string) => void }) {
  return (
    <Section
      title="Pick a Web Browser"
      lead="It becomes your default and goes in the Dock. Others install from Flathub in the background."
    >
      <div className="setup-cards setup-cards--browsers" role="radiogroup" aria-label="Browser">
        {BROWSERS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={chosen === b.id}
            className={cx(
              "setup-card setup-card--browser",
              chosen === b.id && "setup-card--selected",
            )}
            onClick={() => setChosen(b.id)}
          >
            <span
              className="setup-browser-badge"
              style={{ background: b.color }}
              aria-hidden="true"
            >
              {b.name.charAt(0)}
            </span>
            <span className="setup-card__name">{b.name}</span>
            <span className="setup-dim">{b.note}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

function Done({ summary, onFinish }: { summary: string[]; onFinish: () => void }) {
  return (
    <div className="setup-hello setup-done">
      <div className="setup-done__badge">
        <Sparkles size={34} />
      </div>
      <h1 className="setup-title">You’re All Set</h1>
      <ul className="setup-summary">
        {summary.map((line) => (
          <li key={line}>
            <Check size={14} /> {line}
          </li>
        ))}
      </ul>
      <Button variant="primary" className="setup-big-button" onClick={onFinish} autoFocus>
        Start Using HelixOS
      </Button>
    </div>
  )
}

export function SetupApp() {
  useAppTheme()
  const [settings, updateSettings] = useSettings()
  const [step, setStep] = useState<Step>("hello")
  const [direction, setDirection] = useState<"forward" | "back">("forward")
  const [lang, setLang] = useState("en_US.UTF-8")
  const [keyboard, setKeyboard] = useState("us")
  const [assistantChoice, setAssistantChoice] = useState<AssistantChoice>("local")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState<string>(LOCAL_MODELS[0].model)
  const [features, setFeatures] = useState({ memory: true, windowTitle: true, commands: false })
  const [browser, setBrowser] = useState("firefox")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string[]>([])

  useEffect(() => {
    void call("locale_get")
      .then((current) => {
        const match = matchLanguage(current)
        setLang(match.lang)
        setKeyboard(match.keyboard)
      })
      .catch(() => {})
  }, [])

  const index = STEPS.indexOf(step)
  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) >= index ? "forward" : "back")
    setError(null)
    setStep(next)
  }
  const note = (line: string) => setSummary((s) => [...s.filter((x) => x !== line), line])

  /** Apply the current step, then move on. */
  const next = async () => {
    setBusy(true)
    setError(null)
    try {
      if (step === "language") {
        await call("locale_set", { lang })
        await call("hypr_option_set", { key: "input:kb_layout", value: keyboard }).catch(() => {})
        note(`Language: ${matchLanguage(lang).name}`)
      } else if (step === "look") {
        note("Your look and colors")
      } else if (step === "assistant") {
        if (assistantChoice === "off") {
          await updateSettings({ assistant: { enabled: false } })
          note("Assistant turned off")
        } else {
          await updateSettings({ assistant: { enabled: true } })
          await assistant.settings.set("store_history", features.memory)
          await assistant.settings.set("share_window_title", features.windowTitle)
          await assistant.settings.set("allow_shell", features.commands)
          if (assistantChoice === "cloud") {
            if (apiKey.trim()) await assistant.key.store(apiKey.trim())
            await assistant.settings.set("mode", "auto")
            note(apiKey.trim() ? "Assistant: Claude" : "Assistant: add your API key in Settings")
          } else {
            await assistant.settings.set("mode", "local")
            await assistant.settings.set("local_model", model)
            note("Assistant: on this computer")
          }
          await assistant.restart().catch(() => {})
        }
      } else if (step === "browser") {
        const chosen = BROWSERS.find((b) => b.id === browser) as Browser
        if (chosen.flathub)
          await call("setup_install_app", { appId: chosen.flathub, defaultBrowser: true })
        else await call("setup_default_browser", { desktopId: chosen.desktopId }).catch(() => {})
        await updateSettings({ dock: { pinned: pinBrowser(settings.dock.pinned, chosen) } })
        note(
          chosen.flathub
            ? `${chosen.name} is installing (watch the Dynamic Island)`
            : `${chosen.name} is your browser`,
        )
      }
      go(STEPS[index + 1]!)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    await updateSettings({ setup: { done: true } })
    await closeWindow()
  }

  return (
    <div className="setup">
      <div className="setup-backdrop" aria-hidden="true" />
      {step !== "hello" && step !== "done" && (
        <button type="button" className="setup-later" onClick={() => void finish()}>
          Set Up Later
        </button>
      )}
      <main key={step} className={cx("setup-step", `setup-step--${direction}`)}>
        {step === "hello" && <Hello onNext={() => go("language")} />}
        {step === "language" && (
          <LanguageStep
            lang={lang}
            keyboard={keyboard}
            onLang={(l, k) => {
              setLang(l)
              setKeyboard(k)
            }}
            onKeyboard={setKeyboard}
          />
        )}
        {step === "look" && <LookStep settings={settings} update={(s) => void updateSettings(s)} />}
        {step === "assistant" && (
          <AssistantStep
            choice={assistantChoice}
            setChoice={setAssistantChoice}
            apiKey={apiKey}
            setApiKey={setApiKey}
            model={model}
            setModel={setModel}
            features={features}
            setFeatures={setFeatures}
          />
        )}
        {step === "browser" && <BrowserStep chosen={browser} setChosen={setBrowser} />}
        {step === "done" && <Done summary={summary} onFinish={() => void finish()} />}
      </main>
      {step !== "hello" && step !== "done" && (
        <footer className="setup-footer">
          <Button onClick={() => go(STEPS[index - 1]!)} disabled={busy}>
            <ChevronLeft size={14} /> Back
          </Button>
          <div className="setup-dots" aria-hidden="true">
            {STEPS.slice(1, -1).map((s) => (
              <span key={s} className={cx("setup-dot", s === step && "setup-dot--on")} />
            ))}
          </div>
          <div className="setup-footer__end">
            {error && <span className="setup-error">{error}</span>}
            <Button
              variant="primary"
              onClick={() => void next()}
              disabled={
                busy ||
                (step === "assistant" &&
                  assistantChoice === "cloud" &&
                  !!apiKey &&
                  !looksLikeKey(apiKey))
              }
            >
              {busy ? "One moment…" : "Continue"}
            </Button>
          </div>
        </footer>
      )}
    </div>
  )
}
