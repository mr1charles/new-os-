// @vitest-environment node
import { createMockBackend } from "@helixos/sdk/mock"
import {
  appCommands,
  calledCommands,
  definedRustCommands,
  registeredCommands,
  sdkCommands,
  STREAMING_COMMANDS,
} from "@helixos/sdk/testing/commands"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const appDir = fileURLToPath(new URL("..", import.meta.url))

describe("backend commands", () => {
  it("registers every command the app calls", () => {
    const registered = registeredCommands(appDir)
    for (const name of calledCommands(appDir)) expect(registered, name).toContain(name)
  })

  it("types every registered command in the SDK", () => {
    const typed = [...sdkCommands(appDir), ...STREAMING_COMMANDS]
    for (const name of registeredCommands(appDir)) expect(typed, name).toContain(name)
  })

  it("defines each of its own commands in commands.rs", () => {
    const defined = definedRustCommands(appDir)
    for (const name of appCommands(appDir)) expect(defined, name).toContain(name)
  })

  it("mocks every SDK command for browser development", () => {
    const mock = createMockBackend({ latencyMs: 0 })
    expect(Object.keys(mock).sort()).toEqual([...sdkCommands(appDir), ...STREAMING_COMMANDS].sort())
  })
})
