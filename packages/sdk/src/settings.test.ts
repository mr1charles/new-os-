import { beforeEach, describe, expect, it } from "vitest"
import { emitMockEvent, setMockBackend } from "./ipc"
import { createMockBackend } from "./mock"
import { applyPatch, SETTINGS_CHANGED_EVENT, SettingsStore } from "./settings"

describe("applyPatch", () => {
  it("merges objects and replaces arrays", () => {
    const base = { a: { b: 1, c: [1, 2] }, d: "x" }
    expect(applyPatch(base, { a: { c: [3] } })).toEqual({ a: { b: 1, c: [3] }, d: "x" })
    expect(base.a.c).toEqual([1, 2])
  })
})

describe("SettingsStore", () => {
  beforeEach(() => setMockBackend(createMockBackend({ latencyMs: 0 })))

  it("starts from defaults and persists updates", async () => {
    const store = new SettingsStore()
    await store.load()
    expect(store.value.appearance.theme).toBe("dark")
    const seen: string[] = []
    store.subscribe((s) => seen.push(s.appearance.accent))
    await store.update({ appearance: { accent: "pink" } })
    expect(store.value.appearance.accent).toBe("pink")
    expect(store.value.appearance.theme).toBe("dark")
    expect(seen).toContain("pink")
  })

  it("follows changes made elsewhere and ignores invalid values", async () => {
    const store = new SettingsStore()
    await store.load()
    emitMockEvent(SETTINGS_CHANGED_EVENT, { bar: { clock24h: true }, appearance: { theme: 42 } })
    expect(store.value.bar.clock24h).toBe(true)
    expect(store.value.appearance.theme).toBe("dark")
  })

  it("rolls back when the write fails", async () => {
    setMockBackend({
      settings_read: () => ({}),
      settings_update: () => {
        throw new Error("disk full")
      },
    })
    const store = new SettingsStore()
    await store.load()
    await expect(store.update({ dock: { magnification: false } })).rejects.toThrow("disk full")
    expect(store.value.dock.magnification).toBe(true)
  })
})
