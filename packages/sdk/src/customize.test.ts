import { describe, expect, it } from "vitest"
import { patchConfig, customizeInput, diffConfig, parseCustomization, PRESETS } from "./customize"
import { DEFAULT_CONFIG } from "./settings-schema"

describe("customize", () => {
  it("every preset is a valid patch", () => {
    for (const preset of PRESETS) {
      const applied = patchConfig(DEFAULT_CONFIG, preset.patch)
      // Nothing in a preset is dropped by validation.
      const again = patchConfig(applied, preset.patch)
      expect(again).toEqual(applied)
      if (preset.id !== "helix")
        expect(diffConfig(DEFAULT_CONFIG, applied).length).toBeGreaterThan(0)
      else expect(applied).toEqual(DEFAULT_CONFIG)
    }
    expect(PRESETS.find((p) => p.id === "windows")?.patch.dock?.style).toBe("taskbar")
  })

  it("reads the assistant's patch and keeps only allowed changes", () => {
    const reply =
      'Here you go:\n```json\n{"patch": {"dock": {"style": "taskbar", "pinned": []}, "windows": {"controls": "windows", "rounding": 99, "exec": "rm -rf /"}}, "summary": "Taskbar and Windows-style buttons."}\n```'
    const result = parseCustomization(reply, DEFAULT_CONFIG)!
    expect(result.summary).toBe("Taskbar and Windows-style buttons.")
    expect(result.config.dock.style).toBe("taskbar")
    expect(result.config.dock.pinned).toEqual(DEFAULT_CONFIG.dock.pinned)
    expect(result.config.windows.rounding).toBe(28)
    expect(result.changes.map((c) => c.path).sort()).toEqual([
      "dock.style",
      "windows.controls",
      "windows.rounding",
    ])
    expect(parseCustomization("I can't do that", DEFAULT_CONFIG)).toBeNull()
  })

  it("describes the settings to the assistant without private ones", () => {
    const input = customizeInput("make it look like Windows", DEFAULT_CONFIG)
    expect(input).toContain('windows.layout: one of "floating", "arrange", "tiling"')
    expect(input).toContain("windows.rounding: number 0-28")
    expect(input).not.toContain("- dock.pinned")
  })
})
