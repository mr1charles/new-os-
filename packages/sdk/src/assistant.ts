/**
 * The assistant from an app: one-shot tasks ("summarize this"), streamed chat, embeddings,
 * and status. Requests go through the app's Rust backend to assistantd's unix socket.
 */
import {
  parseChatEvent,
  type ChatEvent,
  type ChatRequest,
  type CompleteRequest,
  type CompletionTask,
  type StatusResponse,
} from "./assistant-protocol"
import { call, callStreaming } from "./ipc"
import { SseParser } from "./sse"

export type { ChatEvent, ChatRequest, CompletionTask, StatusResponse }

/** The part of assistant.toml Settings edits (appkit::assistant_config). */
export interface AssistantSettings {
  mode: "auto" | "cloud" | "local"
  name: string
  cloud_model: string
  effort: "low" | "medium" | "high" | "xhigh" | "max"
  local_model: string
  share_window_title: boolean
  store_history: boolean
  allow_shell: boolean
}

export interface Fact {
  id: number
  text: string
  /** Unix seconds. */
  created_at: number
}

export const assistant = {
  status(): Promise<StatusResponse> {
    return call("assistant_request", {
      method: "GET",
      path: "/v1/status",
    }) as Promise<StatusResponse>
  },

  /** One-shot task. Resolves to the model's output text. */
  async complete(
    task: CompletionTask,
    input: string,
    options?: CompleteRequest["options"],
  ): Promise<string> {
    const body: CompleteRequest = { task, input, ...(options ? { options } : {}) }
    const result = (await call("assistant_request", {
      method: "POST",
      path: "/v1/complete",
      body,
    })) as { output?: string }
    return result.output ?? ""
  },

  async embed(input: string[]): Promise<number[][]> {
    const result = (await call("assistant_request", {
      method: "POST",
      path: "/v1/embed",
      body: { input },
    })) as { embeddings?: number[][] }
    return result.embeddings ?? []
  },

  /** Streamed chat. `onEvent` receives each event in order; resolves when the reply ends. */
  async chat(request: ChatRequest, onEvent: (event: ChatEvent) => void): Promise<void> {
    const parser = new SseParser()
    let pending = ""
    const feed = (chunk: string) => {
      pending += chunk
      const lastNewline = pending.lastIndexOf("\n")
      if (lastNewline === -1) return
      const complete = pending.slice(0, lastNewline)
      pending = pending.slice(lastNewline + 1)
      for (const line of complete.split("\n")) {
        const sse = parser.feedLine(line)
        const event = sse && parseChatEvent(sse)
        if (event) onEvent(event)
      }
    }
    await callStreaming("assistant_stream", { path: "/v1/chat", body: request }, feed)
    if (pending) parser.feedLine(pending)
    const last = parser.flush()
    const event = last && parseChatEvent(last)
    if (event) onEvent(event)
  },

  async facts(): Promise<Fact[]> {
    const result = (await call("assistant_request", { method: "GET", path: "/v1/facts" })) as {
      facts?: Fact[]
    }
    return result.facts ?? []
  },

  deleteFact(id: number): Promise<unknown> {
    return call("assistant_request", { method: "DELETE", path: `/v1/facts/${Math.trunc(id)}` })
  },

  settings: {
    read: () => call("assistant_settings_read"),
    set: <K extends keyof AssistantSettings>(field: K, value: AssistantSettings[K]) =>
      call("assistant_settings_set", { field, value }),
  },

  key: {
    isSet: () => call("assistant_key_status"),
    store: (key: string) => call("assistant_key_store", { key }),
    clear: () => call("assistant_key_clear"),
  },

  /** Restart assistantd so it picks up changed settings or a new key. */
  restart: () => call("assistant_restart"),
}
