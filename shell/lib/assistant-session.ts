/**
 * Conversation state for the assistant panel, and the bridge that mirrors a running request
 * into the Dynamic Island while the panel is closed.
 */
import { createState } from "ags"
import { chat, confirmTool, type ChatHandle } from "./assistant"
import { describeTool, type ChatEvent, type ProviderKind } from "./assistant-protocol"
import { island } from "./island"
import { openPopup } from "./popups"
import { hyprland } from "./services"
import { config } from "./config"

export interface ToolChip {
  id: string
  name: string
  label: string
  status: "running" | "ok" | "error"
}

export interface ChatMessage {
  id: number
  role: "user" | "assistant"
  text: string
  tools: ToolChip[]
  error: string
  streaming: boolean
}

const [messages, setMessages] = createState<ChatMessage[]>([])
const [busy, setBusy] = createState(false)
const [provider, setProvider] = createState<{ kind: ProviderKind | "none"; model: string }>({
  kind: "none",
  model: "",
})
export { messages, busy, provider }

let nextId = 1
let conversationId: string | null = null
let handle: ChatHandle | null = null

const ISLAND_ID = "assistant"

function panelOpen() {
  return openPopup.peek() === "assistant"
}

function updateLast(update: (message: ChatMessage) => ChatMessage) {
  setMessages((list) => {
    const last = list.at(-1)
    if (!last || last.role !== "assistant") return list
    return [...list.slice(0, -1), update(last)]
  })
}

function islandAssistant(
  phase: "thinking" | "responding" | "tool" | "done" | "error",
  text: string,
  tool = "",
) {
  if (panelOpen() && phase !== "error") {
    island.dismiss(ISLAND_ID)
    return
  }
  const kind = provider.peek().kind
  const label = kind === "cloud" ? "Cloud" : kind === "local" ? "On-device" : ""
  island.upsert(
    "assistant",
    { phase, text, provider: label, tool },
    { id: ISLAND_ID, ttlMs: phase === "done" || phase === "error" ? 6000 : null },
  )
}

function handleEvent(event: ChatEvent) {
  switch (event.type) {
    case "start":
      conversationId = event.conversation_id
      setProvider({ kind: event.provider, model: event.model })
      islandAssistant("thinking", "")
      break
    case "text":
      updateLast((m) => ({ ...m, text: m.text + event.delta }))
      islandAssistant("responding", messages.peek().at(-1)?.text ?? "")
      break
    case "tool_call":
      updateLast((m) => ({
        ...m,
        tools: [
          ...m.tools,
          { id: event.id, name: event.name, label: describeTool(event.name), status: "running" },
        ],
      }))
      islandAssistant("tool", "", describeTool(event.name))
      break
    case "tool_result":
      updateLast((m) => ({
        ...m,
        tools: m.tools.map((t) =>
          t.id === event.id ? { ...t, status: event.ok ? "ok" : "error" } : t,
        ),
      }))
      break
    case "confirm":
      island.upsert(
        "confirm",
        { requestId: event.request_id, tool: describeTool(event.tool), summary: event.summary },
        { id: `confirm:${event.request_id}` },
      )
      break
    case "fallback":
      // Either the cloud was unreachable (switch to on-device) or Claude's server-side
      // refusal fallback answered with another model.
      setProvider({ kind: event.to, model: event.model })
      break
    case "done":
      updateLast((m) => ({ ...m, streaming: false }))
      setBusy(false)
      islandAssistant("done", messages.peek().at(-1)?.text ?? "")
      break
    case "error":
      updateLast((m) => ({ ...m, streaming: false, error: event.message }))
      setBusy(false)
      islandAssistant("error", event.message)
      break
  }
}

/** Context the assistant gets about what the user is looking at. */
function currentContext() {
  const client = hyprland?.focusedClient
  if (!client) return undefined
  return { app: client.class, window_title: client.title }
}

export function send(text: string) {
  const prompt = text.trim()
  if (prompt.length === 0 || busy.peek()) return
  setMessages((list) => [
    ...list,
    { id: nextId++, role: "user", text: prompt, tools: [], error: "", streaming: false },
    { id: nextId++, role: "assistant", text: "", tools: [], error: "", streaming: true },
  ])
  setBusy(true)
  handle = chat(
    { message: prompt, conversation_id: conversationId, context: currentContext() },
    handleEvent,
  )
  handle.done.finally(() => {
    if (busy.peek()) {
      updateLast((m) => ({ ...m, streaming: false }))
      setBusy(false)
    }
  })
}

export function stop() {
  handle?.cancel()
  handle = null
  updateLast((m) => ({ ...m, streaming: false }))
  setBusy(false)
  island.dismiss(ISLAND_ID)
}

export function newConversation() {
  stop()
  conversationId = null
  setMessages([])
}

export function answerConfirmation(requestId: string, allow: boolean) {
  island.dismiss(`confirm:${requestId}`)
  confirmTool(requestId, allow).catch((error) => console.warn(`newos: confirm failed: ${error}`))
}

export function assistantName() {
  return config.peek().assistant.name || "Assistant"
}
