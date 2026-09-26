/**
 * Terminal sessions: the user's shell in a pseudo-terminal (appkit::pty). `spawn` resolves to
 * a session id at once and keeps delivering output through `onEvent` until the shell exits.
 */
import { call, inTauri, getMockHandler, CommandError } from "./ipc"

export type PtyEvent = { type: "data"; text: string } | { type: "exit" }

export interface SpawnOptions {
  cols: number
  rows: number
  /** Start here instead of the home folder (a new tab opens where the current one is). */
  cwd?: string | null
}

export const terminal = {
  async spawn(options: SpawnOptions, onEvent: (event: PtyEvent) => void): Promise<number> {
    const args = { cols: options.cols, rows: options.rows, cwd: options.cwd ?? null }
    const mock = getMockHandler("term_spawn")
    if (mock || !inTauri()) {
      if (!mock) throw new CommandError("term_spawn", "term_spawn is not available here")
      return (await mock({ ...args, onEvent })) as number
    }
    const { Channel, invoke } = await import("@tauri-apps/api/core")
    const channel = new Channel<PtyEvent>()
    channel.onmessage = onEvent
    try {
      return await invoke<number>("term_spawn", { ...args, onEvent: channel })
    } catch (error) {
      throw new CommandError("term_spawn", typeof error === "string" ? error : String(error))
    }
  },
  write: (id: number, data: string) => call("term_write", { id, data }),
  resize: (id: number, cols: number, rows: number) => call("term_resize", { id, cols, rows }),
  kill: (id: number) => call("term_kill", { id }),
  cwd: (id: number) => call("term_cwd", { id }),
}
