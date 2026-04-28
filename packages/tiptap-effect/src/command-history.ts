import { Effect, type Stream, SubscriptionRef } from "effect"
import type { Command, ReverseKind } from "./command.js"
import type { SelectionInfo } from "./schema/selection.js"

/**
 * A record kept in the live undo stack.
 * `output` is the result of `forward`, used by `reverse` to restore state.
 */
export interface CommandRecord<Op extends string = string, In = unknown, Out = unknown> {
  readonly op: Op
  readonly cmd: Command<Op, In, Out, any, any>
  readonly input: In
  readonly output: Out
  readonly at: number
  /**
   * SelectionInfo captured at dispatch when `cmd.capturesSelection === true`.
   * Restored by the executor before running `reverse`.
   */
  readonly selection?: SelectionInfo | null
  /**
   * `cmd.coalesceKey(input)` evaluated at push-time. Stored on the record so
   * adjacency checks compare the *original* user-action category (e.g.
   * "insert-text:char") and don't drift as merged inputs grow.
   */
  readonly coalesceKey?: string
}

const COALESCE_WINDOW_MS = 500

/**
 * In-memory linear history of Commands. Bounded by `maxSize`.
 *
 * - `push` clears the future stack (branching).
 * - `pushCoalesced` merges into the previous past entry when the previous
 *   entry has the same `op` + `coalesceKey(input)` and was pushed within
 *   `COALESCE_WINDOW_MS`. The merged record uses the new `at` timestamp so
 *   the window rolls forward with each subsequent dispatch.
 * - Any `popLast` (i.e. an undo) terminates the coalesce window because the
 *   prior entry is no longer at the tail of the past stack.
 */
export class CommandHistory extends Effect.Service<CommandHistory>()(
  "tiptap-effect/CommandHistory",
  {
    effect: Effect.gen(function* () {
      const past = yield* SubscriptionRef.make<ReadonlyArray<CommandRecord>>([])
      const future = yield* SubscriptionRef.make<ReadonlyArray<CommandRecord>>([])
      const maxSize = 1000

      const pushPreserveFuture = (record: CommandRecord) =>
        SubscriptionRef.update(past, (arr) => {
          const next = [...arr, record]
          return next.length > maxSize ? next.slice(next.length - maxSize) : next
        })

      const push = (record: CommandRecord) =>
        pushPreserveFuture(record).pipe(
          Effect.zipRight(SubscriptionRef.set(future, [])),
        )

      /**
       * Coalescing push: if the previous past entry has the same op + same
       * stored `coalesceKey` and was pushed within `COALESCE_WINDOW_MS`,
       * delegate to `cmd.coalesce(prev, next)` to fold the new record into the
       * prior one. The coalesce function returns `null` to opt this specific
       * pair out of merging (e.g. inserts at non-adjacent positions). The
       * merged record keeps the *prev* coalesceKey so the original user-action
       * category — not the accumulated state — drives subsequent merges.
       */
      const pushCoalesced = (record: CommandRecord) =>
        SubscriptionRef.update(past, (arr) => {
          const prev = arr.length > 0 ? arr[arr.length - 1]! : null
          const cmd = record.cmd
          const eligible =
            !!prev &&
            !!cmd.coalesce &&
            prev.op === record.op &&
            prev.coalesceKey !== undefined &&
            record.coalesceKey !== undefined &&
            prev.coalesceKey === record.coalesceKey &&
            record.at - prev.at <= COALESCE_WINDOW_MS

          let next: ReadonlyArray<CommandRecord>
          if (eligible) {
            const merged = cmd.coalesce!(
              { input: prev!.input, output: prev!.output },
              { input: record.input, output: record.output },
            )
            if (merged === null) {
              next = [...arr, record]
            } else {
              const mergedRecord: CommandRecord = {
                op: prev!.op,
                cmd: prev!.cmd,
                input: merged.input,
                output: merged.output,
                at: record.at,
                selection: prev!.selection,
                coalesceKey: prev!.coalesceKey,
              }
              next = [...arr.slice(0, -1), mergedRecord]
            }
          } else {
            next = [...arr, record]
          }
          return next.length > maxSize ? next.slice(next.length - maxSize) : next
        }).pipe(Effect.zipRight(SubscriptionRef.set(future, [])))

      const popLast = (): Effect.Effect<CommandRecord | null> =>
        SubscriptionRef.modify(past, (arr): [CommandRecord | null, ReadonlyArray<CommandRecord>] => {
          if (arr.length === 0) return [null, arr]
          const last = arr[arr.length - 1]!
          return [last, arr.slice(0, -1)]
        })

      const pushFuture = (record: CommandRecord) =>
        SubscriptionRef.update(future, (arr) => [...arr, record])

      const popFuture = (): Effect.Effect<CommandRecord | null> =>
        SubscriptionRef.modify(future, (arr): [CommandRecord | null, ReadonlyArray<CommandRecord>] => {
          if (arr.length === 0) return [null, arr]
          const last = arr[arr.length - 1]!
          return [last, arr.slice(0, -1)]
        })

      const list = () => SubscriptionRef.get(past)

      const clear = () =>
        SubscriptionRef.set(past, []).pipe(
          Effect.zipRight(SubscriptionRef.set(future, [])),
        )

      const pastChanges: Stream.Stream<ReadonlyArray<CommandRecord>> = past.changes
      const futureChanges: Stream.Stream<ReadonlyArray<CommandRecord>> =
        future.changes

      return {
        push,
        pushCoalesced,
        pushPreserveFuture,
        popLast,
        pushFuture,
        popFuture,
        list,
        clear,
        pastChanges,
        futureChanges,
      } as const
    }),
  },
) {}

/**
 * Identifier for the `reverse` kind of a Command, useful for runtime branching.
 */
export const reverseKind = (
  reverse: Command<string, any, any, any, any>["reverse"],
): "function" | ReverseKind => {
  if (typeof reverse === "function") return "function"
  return reverse
}
