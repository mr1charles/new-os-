/**
 * Live activities in the Dynamic Island, and notifications.
 *
 * For work that takes a while (copying files, a long build in Terminal), start an activity:
 * the island shows its progress while you work in other apps, and stays small while your app is
 * in front. Post a notification when it finishes if the person has moved on.
 */
import type { AppNotification, IslandActivity } from "./commands"
import { call } from "./ipc"

export const island = {
  show: (id: string, activity: IslandActivity) => call("island_show", { id, activity }),
  end: (id: string) => call("island_end", { id }),
}

export function notify(
  notification: Pick<AppNotification, "app_name" | "icon" | "summary"> & Partial<AppNotification>,
): Promise<number> {
  return call("notify", {
    notification: { body: "", replaces: 0, urgent: false, ...notification },
  })
}

/**
 * An activity that is updated often (every file copied, every progress tick) but only sent
 * to the shell a few times a second. Failures are ignored: the island is a nicety, and the
 * work carries on without it.
 */
export class LiveActivity {
  private last = 0
  private pending: ReturnType<typeof setTimeout> | null = null
  private state: IslandActivity
  private ended = false

  constructor(
    private readonly id: string,
    initial: IslandActivity,
    private readonly intervalMs = 250,
    private readonly send: typeof island = island,
  ) {
    this.state = initial
    this.flush()
  }

  update(patch: Partial<IslandActivity>) {
    if (this.ended) return
    this.state = { ...this.state, ...patch }
    const wait = this.last + this.intervalMs - Date.now()
    if (wait <= 0) this.flush()
    else this.pending ??= setTimeout(() => this.flush(), wait)
  }

  end() {
    if (this.ended) return
    this.ended = true
    if (this.pending) clearTimeout(this.pending)
    this.pending = null
    this.send.end(this.id).catch(() => {})
  }

  private flush() {
    this.pending = null
    if (this.ended) return
    this.last = Date.now()
    this.send.show(this.id, this.state).catch(() => {})
  }
}
