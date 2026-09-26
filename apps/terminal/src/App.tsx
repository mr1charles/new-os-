import { assistant } from "@helixos/sdk"
import { useAppTheme, useSettings } from "@helixos/sdk/react"
import { Badge, Button, cx, Spinner, Toolbar, Window } from "@helixos/ui"
import { Plus, Sparkles, X } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { assessCommand, cleanCommand, lastLines, tabTitle } from "./logic"
import { TerminalView, type TerminalHandle } from "./TerminalView"

interface Tab {
  key: number
  title: string
  cwd: string | null
}

type BarState =
  | { kind: "closed" }
  | { kind: "input"; text: string }
  | { kind: "working"; text: string; what: "command" | "explain" }
  | { kind: "command"; text: string; command: string }
  | { kind: "explain"; text: string }
  | { kind: "error"; text: string; message: string }

/** Ctrl+Space: type what you want in English; the assistant writes the command for you to run. */
function AssistantBar({
  state,
  setState,
  onInsert,
  onExplain,
  close,
}: {
  state: BarState
  setState: (s: BarState) => void
  onInsert: (command: string, run: boolean) => void
  onExplain: () => void
  close: () => void
}) {
  if (state.kind === "closed") return null
  const text = "text" in state ? state.text : ""
  const ask = async () => {
    setState({ kind: "working", text, what: "command" })
    try {
      const command = cleanCommand(await assistant.complete("command", text))
      setState(
        command
          ? { kind: "command", text, command }
          : { kind: "error", text, message: "No command came back." },
      )
    } catch (e) {
      setState({ kind: "error", text, message: e instanceof Error ? e.message : String(e) })
    }
  }
  const risk = state.kind === "command" ? assessCommand(state.command) : null
  return (
    <div className="term-bar" role="dialog" aria-label="Assistant">
      <form
        className="term-bar__row"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) void ask()
        }}
      >
        <Sparkles size={14} className="term-bar__icon" />
        <input
          className="term-bar__input"
          autoFocus
          aria-label="Describe a command"
          placeholder="Describe what you want to do, like “find PDFs bigger than 10 MB”"
          value={text}
          onChange={(e) => setState({ kind: "input", text: e.currentTarget.value })}
          onKeyDown={(e) => e.key === "Escape" && close()}
        />
        <Button
          size="small"
          type="button"
          onClick={onExplain}
          title="Explain the last output or error"
        >
          Explain Output
        </Button>
        <button type="button" className="nx-icon-button" aria-label="Close" onClick={close}>
          <X size={14} />
        </button>
      </form>
      {state.kind === "working" && (
        <div className="term-bar__status">
          <Spinner size={12} />{" "}
          {state.what === "command" ? "Writing a command…" : "Reading the output…"}
        </div>
      )}
      {state.kind === "command" && (
        <div className="term-bar__result">
          <code className="term-bar__command">{state.command}</code>
          {risk && (
            <div className="term-bar__risk">
              <Badge tone={risk.level === "danger" ? "danger" : "warning"}>
                {risk.level === "danger" ? "Dangerous" : "Check first"}
              </Badge>{" "}
              {risk.reason}
            </div>
          )}
          <div className="term-bar__actions">
            <Button size="small" onClick={() => onInsert(state.command, false)}>
              Insert
            </Button>
            <Button
              size="small"
              variant={risk?.level === "danger" ? "destructive" : "primary"}
              onClick={() => onInsert(state.command, true)}
            >
              Run
            </Button>
          </div>
        </div>
      )}
      {state.kind === "explain" && <div className="term-bar__explain">{state.text}</div>}
      {state.kind === "error" && <div className="term-bar__error">{state.message}</div>}
    </div>
  )
}

export function App() {
  useAppTheme()
  const [settings] = useSettings()
  const themeKey = `${settings.appearance.theme}-${settings.appearance.accent}`
  const nextKey = useRef(2)
  const [tabs, setTabs] = useState<Tab[]>([{ key: 1, title: "Terminal", cwd: null }])
  const [active, setActive] = useState(1)
  const handles = useRef(new Map<number, TerminalHandle>())
  const [bar, setBar] = useState<BarState>({ kind: "closed" })

  const current = () => handles.current.get(active)

  const newTab = useCallback(async () => {
    const cwd = (await handles.current.get(active)?.cwd()) ?? null
    const key = nextKey.current++
    setTabs((t) => [...t, { key, title: "Terminal", cwd }])
    setActive(key)
  }, [active])

  const closeTab = useCallback(
    (key: number) => {
      setTabs((list) => {
        const rest = list.filter((t) => t.key !== key)
        if (rest.length === 0) {
          const fresh = nextKey.current++
          setActive(fresh)
          return [{ key: fresh, title: "Terminal", cwd: null }]
        }
        if (key === active)
          setActive(rest[Math.max(0, list.findIndex((t) => t.key === key) - 1)]!.key)
        return rest
      })
    },
    [active],
  )

  const closeBar = () => {
    setBar({ kind: "closed" })
    current()?.focus()
  }

  const explain = async () => {
    const output = lastLines(current()?.lines() ?? [])
    if (!output.trim())
      return setBar({ kind: "error", text: "", message: "There’s no output to explain yet." })
    setBar({ kind: "working", text: "", what: "explain" })
    try {
      setBar({ kind: "explain", text: await assistant.complete("explain", output) })
    } catch (e) {
      setBar({ kind: "error", text: "", message: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Shortcuts, from inside the terminal. Returning false keeps the key from the shell. */
  const shortcut = (e: KeyboardEvent): boolean => {
    if (e.ctrlKey && e.code === "Space") {
      setBar({ kind: "input", text: "" })
      return false
    }
    if (e.ctrlKey && e.shiftKey && e.code === "KeyT") {
      void newTab()
      return false
    }
    if (e.ctrlKey && e.shiftKey && e.code === "KeyW") {
      closeTab(active)
      return false
    }
    if (e.ctrlKey && (e.code === "PageDown" || e.code === "PageUp")) {
      const i = tabs.findIndex((t) => t.key === active)
      const next = tabs[(i + (e.code === "PageDown" ? 1 : -1) + tabs.length) % tabs.length]
      if (next) setActive(next.key)
      return false
    }
    return true
  }

  return (
    <Window>
      <Toolbar
        title=""
        actions={
          <>
            <div className="term-tabs" role="tablist" aria-label="Tabs">
              {tabs.map((t) => (
                <div key={t.key} className={cx("term-tab", t.key === active && "term-tab--active")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={t.key === active}
                    className="term-tab__label"
                    onClick={() => setActive(t.key)}
                  >
                    {t.title}
                  </button>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      className="term-tab__close"
                      aria-label={`Close ${t.title}`}
                      onClick={() => closeTab(t.key)}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="nx-icon-button"
              aria-label="New tab"
              title="New Tab (Ctrl+Shift+T)"
              onClick={() => void newTab()}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              className={cx("nx-icon-button", bar.kind !== "closed" && "term-active")}
              aria-label="Assistant"
              title="Assistant (Ctrl+Space)"
              onClick={() =>
                bar.kind === "closed" ? setBar({ kind: "input", text: "" }) : closeBar()
              }
            >
              <Sparkles size={16} />
            </button>
          </>
        }
      />
      <div className="term-body">
        {tabs.map((t) => (
          <TerminalView
            key={t.key}
            active={t.key === active}
            cwd={t.cwd}
            themeKey={themeKey}
            handle={(h) => {
              if (h) handles.current.set(t.key, h)
              else handles.current.delete(t.key)
            }}
            onTitle={(title) =>
              setTabs((list) =>
                list.map((x) => (x.key === t.key ? { ...x, title: tabTitle(title) } : x)),
              )
            }
            onExit={() => undefined}
            onShortcut={shortcut}
          />
        ))}
        <AssistantBar
          state={bar}
          setState={setBar}
          close={closeBar}
          onExplain={() => void explain()}
          onInsert={(command, run) => {
            current()?.send(command + (run ? "\r" : ""))
            closeBar()
          }}
        />
        {bar.kind === "working" && <div className="term-scrim" aria-hidden="true" />}
      </div>
    </Window>
  )
}
