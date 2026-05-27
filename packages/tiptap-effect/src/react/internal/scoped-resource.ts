import { Effect, Exit, Scope } from "effect"

export interface ScopedResource<A> {
  readonly value: A
  readonly close: () => void
}

export const runScopedResourceSync = <A>(
  acquire: Effect.Effect<A, never, Scope.Scope>,
): ScopedResource<A> => {
  const scope = Effect.runSync(Scope.make())
  const value = Effect.runSync(
    acquire.pipe(Effect.provideService(Scope.Scope, scope)),
  )
  let closed = false

  return {
    value,
    close: () => {
      if (closed) return
      closed = true
      Effect.runSync(Scope.close(scope, Exit.void))
    },
  }
}
