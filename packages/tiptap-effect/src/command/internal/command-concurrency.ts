import { Data, Effect, Stream, SubscriptionRef, Ref } from "effect"
import type { ConcurrencyPolicy } from "../command"
import type { EditorId } from "../../types"

export class CommandBusyError extends Data.TaggedError("CommandBusyError")<{
  readonly op: string
}> {}

export const commandKey = (editorId: EditorId, op: string): string =>
  `${editorId}\u0000${op}`

export interface RunPolicyInput<A, E, R> {
  readonly editorId: EditorId
  readonly op: string
  readonly policy: ConcurrencyPolicy
  readonly interruptExisting: Effect.Effect<void>
  readonly run: (opts: {
    readonly trackOp: boolean
  }) => Effect.Effect<A, E, R>
}

export const makeCommandConcurrency = Effect.gen(function* () {
  const pendingOps = yield* SubscriptionRef.make<
    ReadonlyMap<EditorId, ReadonlySet<string>>
  >(new Map())
  const emptyPendingOps: ReadonlySet<string> = new Set()
  const semaphores = yield* Ref.make<ReadonlyMap<string, Effect.Semaphore>>(
    new Map(),
  )

  const reserveIfFree = (
    editorId: EditorId,
    op: string,
  ): Effect.Effect<boolean> =>
    SubscriptionRef.modify(
      pendingOps,
      (all): [boolean, ReadonlyMap<EditorId, ReadonlySet<string>>] => {
        const set = all.get(editorId) ?? emptyPendingOps
        if (set.has(op)) return [false, all]
        const next = new Map(all)
        const nextSet = new Set(set)
        nextSet.add(op)
        next.set(editorId, nextSet)
        return [true, next]
      },
    )

  const markPending = (editorId: EditorId, op: string) =>
    SubscriptionRef.update(pendingOps, (all) => {
      const next = new Map(all)
      const ops = new Set(next.get(editorId) ?? [])
      ops.add(op)
      next.set(editorId, ops)
      return next
    })

  const unmarkPending = (editorId: EditorId, op: string) =>
    SubscriptionRef.update(pendingOps, (all) => {
      const current = all.get(editorId)
      if (!current?.has(op)) return all
      const next = new Map(all)
      const ops = new Set(current)
      ops.delete(op)
      if (ops.size === 0) next.delete(editorId)
      else next.set(editorId, ops)
      return next
    })

  const getOrCreateSemaphore = (
    key: string,
  ): Effect.Effect<Effect.Semaphore> =>
    Effect.gen(function* () {
      const current = yield* Ref.get(semaphores)
      const existing = current.get(key)
      if (existing) return existing
      const fresh = yield* Effect.makeSemaphore(1)
      return yield* Ref.modify(semaphores, (m) => {
        const winner = m.get(key) ?? fresh
        if (winner === fresh) {
          const next = new Map(m)
          next.set(key, fresh)
          return [fresh, next]
        }
        return [winner, m]
      })
    })

  const runMarked = <A, E, R>(
    editorId: EditorId,
    op: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.zipRight(
      markPending(editorId, op),
      effect.pipe(Effect.ensuring(unmarkPending(editorId, op))),
    )

  const runWithPolicy = <A, E, R>({
    editorId,
    op,
    policy,
    interruptExisting,
    run,
  }: RunPolicyInput<A, E, R>): Effect.Effect<A, E | CommandBusyError, R> => {
    const key = commandKey(editorId, op)
    switch (policy) {
      case "block-while-pending":
        return Effect.gen(function* () {
          const reserved = yield* reserveIfFree(editorId, op)
          if (!reserved) return yield* new CommandBusyError({ op })
          return yield* run({ trackOp: false }).pipe(
            Effect.ensuring(unmarkPending(editorId, op)),
          )
        })
      case "queue":
        return Effect.gen(function* () {
          const sem = yield* getOrCreateSemaphore(key)
          return yield* sem.withPermits(1)(
            runMarked(editorId, op, run({ trackOp: false })),
          )
        })
      case "interrupt-and-replace":
        return interruptExisting.pipe(
          Effect.zipRight(runMarked(editorId, op, run({ trackOp: true }))),
        )
      case "allow-concurrent":
        return runMarked(editorId, op, run({ trackOp: false }))
    }
  }

  const isPending = (editorId: EditorId, op: string): Effect.Effect<boolean> =>
    Effect.map(
      SubscriptionRef.get(pendingOps),
      (all) => all.get(editorId)?.has(op) ?? false,
    )

  const pendingChanges = (
    editorId: EditorId,
  ): Stream.Stream<ReadonlySet<string>> =>
    pendingOps.changes.pipe(
      Stream.map((all) => all.get(editorId) ?? emptyPendingOps),
      Stream.changes,
    )

  return {
    runWithPolicy,
    isPending,
    pendingChanges,
  } as const
})

export type CommandConcurrency = Effect.Effect.Success<
  typeof makeCommandConcurrency
>
