import { createPoll } from "ags/time"

/** Current time in epoch ms, ticking every second while something is subscribed. */
export const now = createPoll(Date.now(), 1000, () => Date.now())

/** Ticks once a minute, for things like the auto theme. */
export const minute = createPoll(Date.now(), 60_000, () => Date.now())
