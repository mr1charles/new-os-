/** Night Shift through hyprsunset (warmer colors in the evening). */
import { createEffect } from "ags"
import { subprocess, type Process } from "ags/process"
import { config } from "./config"
import { hasProgram } from "./system"

let process: Process | null = null

export function setupNightShift() {
  createEffect(() => {
    const { enabled, temperature } = config().nightShift
    process?.kill()
    process = null
    if (enabled && hasProgram("hyprsunset")) {
      process = subprocess(
        ["hyprsunset", "--temperature", String(temperature)],
        () => undefined,
        () => undefined,
      )
    }
  })
}
