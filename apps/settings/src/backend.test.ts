/**
 * The frontend calls commands by name, so a typo or a command missing from the Rust side only
 * fails at runtime. This keeps the three lists in step: the SDK's typed `Commands`, the Tauri
 * handlers registered in src-tauri/src/main.rs, and the browser mock.
 */
import { createMockBackend } from "@newos/sdk/mock"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

/** Keys of `export interface Commands { ... }`. */
function sdkCommands(): string[] {
  const source = read("../../../packages/sdk/src/commands.ts")
  const body = source.slice(source.indexOf("export interface Commands {"))
  const block = body.slice(0, body.indexOf("\n}\n"))
  return [...block.matchAll(/^ {2}(\w+): \[/gm)].map((m) => m[1]!)
}

/** The app's own handlers: `tauri::generate_handler![commands::a, ...]` in main.rs. */
function appCommands(): string[] {
  const source = read("../src-tauri/src/main.rs")
  const block = source.slice(
    source.indexOf("generate_handler!["),
    source.indexOf("])", source.indexOf("generate_handler![")),
  )
  return [...block.matchAll(/commands::(\w+)/g)].map((m) => m[1]!)
}

/** Commands every app gets from newos-appkit (`COMMANDS` in tauri_app.rs). */
function sharedCommands(): string[] {
  const source = read("../../../services/appkit/src/tauri_app.rs")
  const block = source.slice(
    source.indexOf("pub const COMMANDS"),
    source.indexOf("];", source.indexOf("pub const COMMANDS")),
  )
  return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]!)
}

const registeredCommands = () => [...sharedCommands(), ...appCommands()]

// Streaming commands take a channel, so they are called through callStreaming, not Commands.
const STREAMING = ["assistant_stream"]

describe("backend commands", () => {
  it("registers every command the SDK declares, and nothing else", () => {
    expect(registeredCommands().sort()).toEqual([...sdkCommands(), ...STREAMING].sort())
  })

  it("defines each Rust command in commands.rs", () => {
    const source = read("../src-tauri/src/commands.rs")
    for (const name of appCommands()) {
      expect(source, name).toMatch(new RegExp(`pub (async )?fn ${name}\\(`))
    }
  })

  it("mocks every command for browser development", () => {
    const mock = createMockBackend({ latencyMs: 0 })
    expect(Object.keys(mock).sort()).toEqual([...sdkCommands(), ...STREAMING].sort())
  })
})
