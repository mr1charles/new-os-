import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import Pango from "gi://Pango?version=1.0"
import { createComputed, createEffect, For, type Accessor } from "ags"
import PopupWindow from "./PopupWindow"
import {
  busy,
  messages,
  newConversation,
  provider,
  send,
  stop,
  type ChatMessage,
} from "../lib/assistant-session"
import { markdownToPango } from "../lib/markdown"
import { config } from "../lib/config"
import { island } from "../lib/island"
import { hidePopup } from "../lib/popups"
import { getStatus } from "../lib/assistant"
import { createState } from "ags"

const VERTICAL = Gtk.Orientation.VERTICAL

const SUGGESTIONS = [
  "Set a timer for 10 minutes",
  "Turn on Do Not Disturb",
  "How much battery do I have left?",
  "Make a note with today's to-dos",
  "Find my recent PDFs",
  "Switch to dark mode",
]

function ToolChips({ message }: { message: Accessor<ChatMessage | undefined> }) {
  const tools = message.as((m) => m?.tools ?? [])
  return (
    <box class="tool-chips" spacing={6} visible={tools.as((t) => t.length > 0)}>
      <For each={tools} id={(t) => t.id}>
        {(tool) => (
          <box
            class={message.as(
              (m) => `tool-chip ${m?.tools.find((t) => t.id === tool.id)?.status ?? "running"}`,
            )}
            spacing={4}
          >
            <image
              iconName={message.as((m) => {
                const status = m?.tools.find((t) => t.id === tool.id)?.status
                return status === "ok"
                  ? "object-select-symbolic"
                  : status === "error"
                    ? "dialog-error-symbolic"
                    : "content-loading-symbolic"
              })}
              pixelSize={12}
            />
            <label label={tool.label} />
          </box>
        )}
      </For>
    </box>
  )
}

function Bubble({ id, role }: { id: number; role: "user" | "assistant" }) {
  const message = messages.as((list) => list.find((m) => m.id === id))
  if (role === "user") {
    return (
      <box class="bubble-row user" halign={Gtk.Align.END}>
        <label
          class="bubble user"
          label={message.as((m) => m?.text ?? "")}
          wrap
          selectable
          xalign={0}
          maxWidthChars={52}
        />
      </box>
    )
  }
  const markup = message.as((m) => {
    if (!m) return ""
    if (m.text.length === 0 && m.streaming) return m.tools.length > 0 ? "" : "<i>Thinking…</i>"
    return markdownToPango(m.text)
  })
  return (
    <box class="bubble-row assistant" orientation={VERTICAL} spacing={6} halign={Gtk.Align.START}>
      <ToolChips message={message} />
      <label
        class="bubble assistant"
        label={markup}
        visible={markup.as((t) => t.length > 0)}
        useMarkup
        wrap
        wrapMode={Pango.WrapMode.WORD_CHAR}
        selectable
        xalign={0}
        maxWidthChars={64}
      />
      <label
        class="bubble-error"
        label={message.as((m) => m?.error ?? "")}
        visible={message.as((m) => (m?.error ?? "") !== "")}
        wrap
        xalign={0}
        maxWidthChars={64}
      />
    </box>
  )
}

function Suggestions() {
  return (
    <box class="suggestions" orientation={VERTICAL} spacing={10}>
      <label
        class="suggestions-title"
        label={config.as((c) => `What can ${c.assistant.name} do for you?`)}
        xalign={0}
      />
      <box spacing={6} homogeneous>
        {SUGGESTIONS.slice(0, 3).map((text) => (
          <button class="suggestion" onClicked={() => send(text)}>
            <label label={text} wrap maxWidthChars={18} />
          </button>
        ))}
      </box>
      <box spacing={6} homogeneous>
        {SUGGESTIONS.slice(3).map((text) => (
          <button class="suggestion" onClicked={() => send(text)}>
            <label label={text} wrap maxWidthChars={18} />
          </button>
        ))}
      </box>
    </box>
  )
}

/** The assistant: a Spotlight-sized conversation panel under the island (Super+Space). */
export default function AssistantPanel() {
  let entry: Gtk.Entry | null = null
  let scroller: Gtk.ScrolledWindow | null = null
  const [serviceNote, setServiceNote] = createState("")

  const providerLabel = createComputed(() => {
    const p = provider()
    if (p.kind === "cloud") return `Cloud · ${p.model}`
    if (p.kind === "local") return `On-device · ${p.model}`
    return ""
  })

  const submit = () => {
    if (!entry) return
    const text = entry.text
    entry.text = ""
    send(text)
  }

  // Keep the newest text in view while replies stream in.
  createEffect(() => {
    messages()
    GLib.idle_add(GLib.PRIORITY_LOW, () => {
      const adjustment = scroller?.get_vadjustment()
      if (adjustment) adjustment.set_value(adjustment.get_upper() - adjustment.get_page_size())
      return GLib.SOURCE_REMOVE
    })
  })

  const onShow = () => {
    island.dismiss("assistant")
    entry?.grab_focus()
    getStatus().then((status) => {
      if (!status)
        setServiceNote(
          "The assistant service is not running. Start it with: systemctl --user start newos-assistantd",
        )
      else if (status.active === "none")
        setServiceNote(
          "No model available. Add an API key or install a local model in Settings → Assistant.",
        )
      else setServiceNote("")
    })
  }

  return (
    <PopupWindow
      name="assistant"
      namespace="newos-assistant"
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.START}
      marginTop={52}
      onShow={onShow}
    >
      <box class="assistant-panel panel" orientation={VERTICAL} widthRequest={660}>
        <box class="assistant-header" spacing={8}>
          <image iconName="newos-sparkle-symbolic" class="accent-icon" pixelSize={20} />
          <label class="assistant-title" label={config.as((c) => c.assistant.name)} xalign={0} />
          <label
            class="provider-badge"
            label={providerLabel}
            visible={providerLabel.as((l) => l.length > 0)}
          />
          <box hexpand />
          <button class="flat-icon" tooltipText="New conversation" onClicked={newConversation}>
            <image iconName="document-new-symbolic" />
          </button>
          <button
            class="flat-icon"
            tooltipText="Close (Esc)"
            onClicked={() => hidePopup("assistant")}
          >
            <image iconName="window-close-symbolic" />
          </button>
        </box>
        <label
          class="service-note"
          label={serviceNote}
          visible={serviceNote.as((n) => n.length > 0)}
          wrap
          xalign={0}
        />
        <scrolledwindow
          $={(self) => (scroller = self)}
          class="assistant-scroll"
          hscrollbarPolicy={Gtk.PolicyType.NEVER}
          propagateNaturalHeight
          maxContentHeight={440}
        >
          <box class="assistant-messages" orientation={VERTICAL} spacing={12}>
            <box visible={messages.as((m) => m.length === 0)}>
              <Suggestions />
            </box>
            <For each={messages} id={(m) => m.id}>
              {(m) => <Bubble id={m.id} role={m.role} />}
            </For>
          </box>
        </scrolledwindow>
        <box class="assistant-input" spacing={8}>
          <entry
            $={(self) => (entry = self)}
            hexpand
            placeholderText={config.as((c) => `Ask ${c.assistant.name} anything…`)}
            onActivate={submit}
          />
          <button
            class="send-button"
            tooltipText={busy.as((b) => (b ? "Stop" : "Send"))}
            onClicked={() => (busy.peek() ? stop() : submit())}
          >
            <image
              iconName={busy.as((b) => (b ? "media-playback-stop-symbolic" : "go-up-symbolic"))}
            />
          </button>
        </box>
      </box>
    </PopupWindow>
  )
}
