import type { Atom, Registry } from "@effect-atom/atom"
import { Result } from "@effect-atom/atom"
import type { Effect } from "effect"

/**
 * Subscribe to a Result-bearing atom and resolve on first Success/Failure.
 * Throws on Failure so test code can `await` it ergonomically.
 */
export const waitForAtom = <A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
): Promise<A> =>
  new Promise((resolve, reject) => {
    const tryResolve = (r: Result.Result<A, E>) => {
      if (Result.isSuccess(r)) {
        unsub()
        resolve(r.value)
        return true
      }
      if (Result.isFailure(r)) {
        unsub()
        reject(r.cause)
        return true
      }
      return false
    }
    const unsub = registry.subscribe(atom, tryResolve)
    if (tryResolve(registry.get(atom))) return
  })

export type _EnsureUsed = Effect.Effect<unknown> // keep imports stable
