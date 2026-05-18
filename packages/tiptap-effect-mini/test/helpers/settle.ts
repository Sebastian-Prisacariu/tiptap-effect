import { Effect } from "effect"

export const settle = () => Effect.runPromise(Effect.yieldNow())

