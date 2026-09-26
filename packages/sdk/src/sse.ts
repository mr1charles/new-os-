/**
 * Incremental Server-Sent Events parser (https://html.spec.whatwg.org/#event-stream-interpretation).
 * Feed it one line at a time without the trailing newline; it returns an event when a blank
 * line completes one.
 */
export interface SseEvent {
  event: string
  data: string
  id: string | null
}

export class SseParser {
  #event = ""
  #data: string[] = []
  #id: string | null = null
  #hasData = false

  feedLine(rawLine: string): SseEvent | null {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (line === "") return this.#dispatch()
    if (line.startsWith(":")) return null

    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)

    switch (field) {
      case "event":
        this.#event = value
        break
      case "data":
        this.#data.push(value)
        this.#hasData = true
        break
      case "id":
        this.#id = value
        break
      default:
        // "retry" and unknown fields are ignored.
        break
    }
    return null
  }

  /** Feed a chunk that may contain several lines. Returns every completed event. */
  feed(chunk: string): SseEvent[] {
    const events: SseEvent[] = []
    for (const line of chunk.split("\n")) {
      const event = this.feedLine(line)
      if (event) events.push(event)
    }
    return events
  }

  /** Dispatch a trailing event when the stream ends without a final blank line. */
  flush(): SseEvent | null {
    return this.#dispatch()
  }

  #dispatch(): SseEvent | null {
    if (!this.#hasData) {
      this.#event = ""
      return null
    }
    const event: SseEvent = {
      event: this.#event || "message",
      data: this.#data.join("\n"),
      id: this.#id,
    }
    this.#event = ""
    this.#data = []
    this.#hasData = false
    return event
  }
}
