import { describe, expect, it } from "vitest"
import { SseParser } from "./sse"
import { describeTool, parseChatEvent, parseSystemEvent } from "./assistant-protocol"

describe("SseParser", () => {
  it("parses named events with JSON data", () => {
    const parser = new SseParser()
    const events = parser.feed('event: text\ndata: {"delta":"Hi"}\n\n')
    expect(events).toEqual([{ event: "text", data: '{"delta":"Hi"}', id: null }])
  })

  it("joins multi-line data, ignores comments and handles CRLF", () => {
    const parser = new SseParser()
    const events = parser.feed(": keepalive\r\ndata: a\r\ndata: b\r\nid: 7\r\n\r\n")
    expect(events).toEqual([{ event: "message", data: "a\nb", id: "7" }])
  })

  it("works line by line and flushes a trailing event", () => {
    const parser = new SseParser()
    expect(parser.feedLine("event: done")).toBeNull()
    expect(parser.feedLine('data: {"stop_reason":"end_turn"}')).toBeNull()
    expect(parser.flush()).toEqual({ event: "done", data: '{"stop_reason":"end_turn"}', id: null })
  })

  it("drops events without data", () => {
    const parser = new SseParser()
    expect(parser.feed("event: ping\n\n")).toEqual([])
  })
})

describe("assistant protocol", () => {
  it("parses chat events and tags the type", () => {
    expect(parseChatEvent({ event: "text", data: '{"delta":"x"}', id: null })).toEqual({
      type: "text",
      delta: "x",
    })
    expect(
      parseChatEvent({
        event: "start",
        data: '{"conversation_id":"c1","provider":"local","model":"m"}',
        id: null,
      }),
    ).toEqual({ type: "start", conversation_id: "c1", provider: "local", model: "m" })
  })

  it("rejects unknown events and bad JSON", () => {
    expect(parseChatEvent({ event: "evil", data: "{}", id: null })).toBeNull()
    expect(parseChatEvent({ event: "text", data: "not json", id: null })).toBeNull()
    expect(parseChatEvent({ event: "text", data: "[1]", id: null })).toBeNull()
    expect(parseSystemEvent({ event: "text", data: "{}", id: null })).toBeNull()
  })

  it("parses system events", () => {
    expect(
      parseSystemEvent({ event: "timer_cancelled", data: '{"timer_id":"t1"}', id: null }),
    ).toEqual({ type: "timer_cancelled", timer_id: "t1" })
  })

  it("describes tools for people", () => {
    expect(describeTool("set_timer")).toBe("Setting a timer")
    expect(describeTool("some_new_tool")).toBe("some new tool")
  })
})
