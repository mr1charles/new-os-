/**
 * The startup animation's timeline (widgets/Startup.tsx; the Plymouth boot splash in
 * distro/plymouth/helixos follows the same beats). Pure, tested in Node.
 */

export interface StartupStep {
  /** Milliseconds from the start. */
  at: number
  name: "logo" | "name" | "flash" | "out" | "done"
}

export const STARTUP_STEPS: StartupStep[] = [
  { at: 80, name: "logo" }, // the logo scales and fades in
  { at: 1000, name: "name" }, // "elixOS" slides out from its right
  { at: 2150, name: "flash" }, // a white flash
  { at: 2500, name: "out" }, // everything fades to show the desktop
  { at: 3100, name: "done" },
]

/**
 * The steps to run. After a real boot the Plymouth splash has already faded the logo in at the
 * same spot, so the login screen continues from there: it starts with the logo showing.
 */
export function startupTimeline(fromBoot: boolean): StartupStep[] {
  if (!fromBoot) return STARTUP_STEPS
  const shift = STARTUP_STEPS.find((s) => s.name === "name")!.at - 250
  return STARTUP_STEPS.filter((s) => s.name !== "logo").map((s) => ({ ...s, at: s.at - shift }))
}

/** Whether to play at session start: once per login, and not after the login screen did. */
export function shouldPlayAtLogin(env: {
  enabled: boolean
  alreadyPlayed: boolean
  fromGreeter: boolean
}) {
  return env.enabled && !env.alreadyPlayed && !env.fromGreeter
}
