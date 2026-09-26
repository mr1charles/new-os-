/**
 * One terminal tab: xterm.js connected to a shell session. It keeps running while hidden, so
 * switching tabs never interrupts a program.
 */
import { island, notify, terminal as pty, type PtyEvent } from "@helixos/sdk"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal, type ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useImperativeHandle, useRef, type Ref } from "react"
import { CommandTracker, finishedMessage, LONG_COMMAND_MS } from "./logic"

const DARK: ITheme = {
  background: "#1e1e1e",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  black: "#1e1e1e",
  red: "#ff6b68",
  green: "#5ad07a",
  yellow: "#f6c85f",
  blue: "#5aa9ff",
  magenta: "#d38aea",
  cyan: "#5ed4dd",
  white: "#d0d0d0",
  brightBlack: "#7a7a7a",
  brightRed: "#ff8a88",
  brightGreen: "#7ee29a",
  brightYellow: "#ffd98a",
  brightBlue: "#86c1ff",
  brightMagenta: "#e3a8f2",
  brightCyan: "#8ae3ea",
  brightWhite: "#ffffff",
}

const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#1d1d1f",
  cursor: "#1d1d1f",
  black: "#1d1d1f",
  red: "#c4262e",
  green: "#1d8a3a",
  yellow: "#9a6a00",
  blue: "#0a5fd1",
  magenta: "#9b3fb8",
  cyan: "#0f7f8a",
  white: "#c7c7cc",
  brightBlack: "#6e6e73",
  brightRed: "#e0383e",
  brightGreen: "#28a745",
  brightYellow: "#b88600",
  brightBlue: "#2a7fff",
  brightMagenta: "#b754d6",
  brightCyan: "#169aa6",
  brightWhite: "#ffffff",
}

/** The palette for the current appearance, with the accent as selection color. */
function theme(): ITheme {
  const root = getComputedStyle(document.documentElement)
  const dark = document.documentElement.dataset.theme !== "light"
  const accent = root.getPropertyValue("--helixos-accent").trim() || "#0a84ff"
  return {
    ...(dark ? DARK : LIGHT),
    selectionBackground: `${accent}55`,
    cursorAccent: dark ? DARK.background : LIGHT.background,
  }
}

export interface TerminalHandle {
  /** Type into the shell (no Enter unless the text has "\r"). */
  send(text: string): void
  /** Visible output lines, for "Explain". */
  lines(): string[]
  focus(): void
  cwd(): Promise<string | null>
}

export interface TerminalViewProps {
  active: boolean
  cwd?: string | null
  onTitle: (title: string) => void
  /** The shell exited; `restart` starts a new one in this tab. */
  onExit: () => void
  handle?: Ref<TerminalHandle>
  /** Keyboard shortcuts the app handles (new tab, assistant...). Return false to consume. */
  onShortcut?: (event: KeyboardEvent) => boolean
  themeKey: string
}

export function TerminalView({
  active,
  cwd,
  onTitle,
  onExit,
  handle,
  onShortcut,
  themeKey,
}: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const session = useRef<number | null>(null)
  const callbacks = useRef({ onTitle, onExit, onShortcut })
  callbacks.current = { onTitle, onExit, onShortcut }

  useImperativeHandle(handle, () => ({
    send: (text) => {
      if (session.current !== null) void pty.write(session.current, text)
    },
    lines: () => {
      const t = term.current
      if (!t) return []
      const buffer = t.buffer.active
      const out: string[] = []
      for (let i = 0; i < buffer.length; i++)
        out.push(buffer.getLine(i)?.translateToString(true) ?? "")
      return out
    },
    focus: () => term.current?.focus(),
    cwd: async () => (session.current === null ? null : pty.cwd(session.current).catch(() => null)),
  }))

  useEffect(() => {
    if (!host.current) return
    const t = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      theme: theme(),
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.open(host.current)
    f.fit()
    term.current = t
    fit.current = f

    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true
      // Ctrl+Shift+C / V copy and paste, like Linux terminals.
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
        const text = t.getSelection()
        if (text) void navigator.clipboard?.writeText(text)
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyV") {
        void navigator.clipboard?.readText().then((text) => text && t.paste(text))
        return false
      }
      return callbacks.current.onShortcut?.(e) ?? true
    })
    let title = ""
    t.onTitleChange((next) => {
      title = next
      callbacks.current.onTitle(next)
    })

    // Long commands: a live activity in the Dynamic Island while they run, and a notification
    // when they finish if Terminal isn't in front.
    const tracker = new CommandTracker()
    const activityId = `command-${Math.random().toString(36).slice(2)}`
    let activityTimer: ReturnType<typeof setTimeout> | null = null
    let activityShown = false
    const endActivity = () => {
      if (activityTimer) clearTimeout(activityTimer)
      activityTimer = null
      if (activityShown) void island.end(activityId).catch(() => {})
      activityShown = false
    }
    const osc = t.parser.registerOscHandler(133, (data) => {
      const event = tracker.handle(data)
      if (!event) return false
      if ("started" in event) {
        endActivity()
        const command = event.started
        activityTimer = setTimeout(() => {
          activityShown = true
          void island
            .show(activityId, {
              app: "org.helixos.Terminal",
              icon: "utilities-terminal",
              title: command || title || "Running a command",
              subtitle: "Running in Terminal",
              progress: null,
            })
            .catch(() => {})
        }, LONG_COMMAND_MS)
      } else {
        endActivity()
        if (event.finished.durationMs >= LONG_COMMAND_MS && !document.hasFocus()) {
          const message = finishedMessage(event.finished, title)
          void notify({ app_name: "Terminal", icon: "utilities-terminal", ...message }).catch(
            () => {},
          )
        }
      }
      // Let xterm see the mark too (it ignores 133).
      return false
    })

    let disposed = false
    const onEvent = (event: PtyEvent) => {
      if (event.type === "data") t.write(event.text)
      else {
        session.current = null
        t.write("\r\n\x1b[2m[Process completed. Press Enter to start a new shell.]\x1b[0m\r\n")
        callbacks.current.onExit()
      }
    }
    const start = () =>
      pty
        .spawn({ cols: t.cols, rows: t.rows, cwd }, onEvent)
        .then((id) => {
          if (disposed) void pty.kill(id)
          else session.current = id
        })
        .catch((e: unknown) =>
          t.write(
            `\x1b[31mCould not start the shell: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`,
          ),
        )
    void start()

    const input = t.onData((data) => {
      if (session.current !== null) void pty.write(session.current, data)
      else if (data === "\r") {
        t.clear()
        void start()
      }
    })
    const resize = t.onResize(({ cols, rows }) => {
      if (session.current !== null) void pty.resize(session.current, cols, rows)
    })
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent !== null) f.fit()
    })
    observer.observe(host.current)

    return () => {
      disposed = true
      osc.dispose()
      endActivity()
      observer.disconnect()
      input.dispose()
      resize.dispose()
      if (session.current !== null) void pty.kill(session.current)
      t.dispose()
    }
    // A tab's terminal lives as long as the tab; `cwd` only matters at the start.
  }, [])

  // Follow light/dark and accent changes.
  useEffect(() => {
    if (term.current) term.current.options.theme = theme()
  }, [themeKey])

  // A tab that becomes visible may have been resized while hidden.
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      fit.current?.fit()
      term.current?.focus()
    })
  }, [active])

  return <div className="term-view" ref={host} hidden={!active} />
}
