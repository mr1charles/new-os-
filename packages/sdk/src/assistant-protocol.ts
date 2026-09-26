/**
 * Wire types for assistantd's local HTTP API (services/assistantd/src/api.rs).
 * Field names are snake_case on the wire and here, so nothing needs mapping.
 */
import type { SseEvent } from "./sse"

export type ProviderKind = "cloud" | "local"

export type ChatEvent =
  | { type: "start"; conversation_id: string; provider: ProviderKind; model: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string }
  | { type: "confirm"; request_id: string; tool: string; summary: string }
  | { type: "fallback"; from: ProviderKind; to: ProviderKind; model: string; reason: string }
  | { type: "done"; stop_reason: string }
  | { type: "error"; message: string }

export type SystemEvent =
  | {
      type: "timer_started"
      timer_id: string
      label: string
      ends_at_ms: number
      duration_ms: number
    }
  | { type: "timer_cancelled"; timer_id: string }
  | { type: "provider_changed"; provider: ProviderKind | "none"; model: string }
  | { type: "notify"; title: string; body: string }

export interface StatusResponse {
  version: string
  mode: "auto" | "cloud" | "local"
  active: ProviderKind | "none"
  online: boolean
  cloud: {
    configured: boolean
    model: string
    key_source: "environment" | "keyring" | "file" | null
  }
  local: { available: boolean; model: string; url: string }
  assistant_name: string
}

export interface ChatRequest {
  message: string
  conversation_id?: string | null
  context?: {
    app?: string
    window_title?: string
    selection?: string
  }
}

export type CompletionTask =
  "summarize" | "rewrite" | "classify" | "reply" | "explain" | "command" | "extract" | "title"

export interface CompleteRequest {
  task: CompletionTask
  input: string
  options?: Record<string, string | string[]>
}

const CHAT_TYPES = new Set([
  "start",
  "text",
  "tool_call",
  "tool_result",
  "confirm",
  "fallback",
  "done",
  "error",
])
const SYSTEM_TYPES = new Set(["timer_started", "timer_cancelled", "provider_changed", "notify"])

function parse(ev: SseEvent, allowed: Set<string>): Record<string, unknown> | null {
  if (!allowed.has(ev.event)) return null
  try {
    const data = JSON.parse(ev.data) as unknown
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null
    return { ...(data as Record<string, unknown>), type: ev.event }
  } catch {
    return null
  }
}

export function parseChatEvent(ev: SseEvent): ChatEvent | null {
  return parse(ev, CHAT_TYPES) as ChatEvent | null
}

export function parseSystemEvent(ev: SseEvent): SystemEvent | null {
  return parse(ev, SYSTEM_TYPES) as SystemEvent | null
}

/** Human label for a tool call, shown as a chip in the assistant panel and island. */
export function describeTool(name: string): string {
  const labels: Record<string, string> = {
    get_system_status: "Checking your system",
    set_volume: "Changing volume",
    set_mute: "Muting sound",
    set_brightness: "Adjusting brightness",
    set_wifi: "Switching Wi-Fi",
    set_bluetooth: "Switching Bluetooth",
    set_dark_mode: "Changing appearance",
    set_do_not_disturb: "Changing Focus",
    lock_screen: "Locking the screen",
    suspend: "Going to sleep",
    open_app: "Opening an app",
    list_windows: "Looking at your windows",
    focus_window: "Switching windows",
    open_url: "Opening a link",
    search_files: "Searching your files",
    open_path: "Opening a file",
    read_text_file: "Reading a file",
    create_note: "Writing a note",
    append_note: "Updating a note",
    list_notes: "Looking through notes",
    read_note: "Reading a note",
    set_timer: "Setting a timer",
    cancel_timer: "Cancelling a timer",
    remember: "Remembering that",
    forget: "Forgetting that",
    run_shell: "Running a command",
    move_to_trash: "Moving to Trash",
  }
  return labels[name] ?? name.replace(/_/g, " ")
}
