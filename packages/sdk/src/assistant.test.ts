import { describe, expect, it } from "vitest"
import { assistant } from "./assistant"
import type { ChatEvent } from "./assistant-protocol"
import { call, setMockBackend } from "./ipc"
import { createMockBackend } from "./mock"

describe("assistant client", () => {
  it("parses a chat stream split across arbitrary chunks", async () => {
    const stream =
      'event: start\ndata: {"conversation_id":"c1","provider":"cloud","model":"claude-opus-5"}\n\n' +
      'event: text\ndata: {"delta":"Hel"}\n\nevent: text\ndata: {"delta":"lo"}\n\n' +
      'event: done\ndata: {"stop_reason":"end_turn"}'
    setMockBackend({
      ...createMockBackend({ latencyMs: 0 }),
      ...{
        assistant_stream: ({ onChunk }: Record<string, unknown>) => {
          const send = onChunk as (chunk: string) => void
          for (let i = 0; i < stream.length; i += 7) send(stream.slice(i, i + 7))
        },
      },
    })
    const events: ChatEvent[] = []
    await assistant.chat({ message: "hi" }, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(["start", "text", "text", "done"])
    expect(
      events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.delta : "")),
    ).toEqual(["Hel", "lo"])
  })

  it("reads status, completions, and facts", async () => {
    setMockBackend(createMockBackend({ latencyMs: 0 }))
    expect((await assistant.status()).active).toBe("local")
    await assistant.key.store("sk-ant-api03-0123456789abcdef")
    expect((await assistant.status()).active).toBe("cloud")
    expect(await assistant.complete("summarize", "a long text")).toContain("a long text")
    const facts = await assistant.facts()
    const count = facts.length
    await assistant.deleteFact(facts[0]!.id)
    expect(await assistant.facts()).toHaveLength(count - 1)
  })

  it("rejects commands the backend does not have", async () => {
    setMockBackend({})
    await expect(call("about")).rejects.toThrow("about is not available here")
  })
})
