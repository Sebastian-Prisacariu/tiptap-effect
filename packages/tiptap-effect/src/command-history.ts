import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect, type Stream, SubscriptionRef } from "effect"
import type { CoalescePair, ReverseKind } from "./command.js"
import type { SelectionInfo } from "./schema/selection.js"

/**
 * A record kept in the live undo/redo stacks.
 *
 * `forwardEffect` re-runs the command's forward for redo.
 * `reverseEffect` undoes the command; it receives the *current* stored
 * `output` so that redo-then-undo always operates on the freshest output
 * rather than a stale closure value.
 */
export interface CommandRecord {
  readonly op: string
  readonly input: unknown
  readonly output: unknown
  readonly at: number
  readonly forwardEffect: (editor: TiptapEditor) => Effect.Effect<unknown, unknown>
  readonly reverseEffect:
    | ReverseKind
    | ((editor: TiptapEditor, output: unknown) => Effect.Effect<void, unknown>)
  /**
   * SelectionInfo captured at dispatch when `capturesSelection === true`.
   * Restored by the executor before running `reverseEffect`.
   */
  readonly selection?: SelectionInfo | null
  /**
   * `cmd.coalesceKey(input)` evaluated at push-time. Stored on the record so
   * adjacency checks compare the *original* user-action category (e.g.
   * "insert-text:char") and don't drift as merged inputs grow.
   */
  readonly coalesceKey?: string
  /**
   * Merge `prev` and `next` CoalescePairs into a new record. Returns `null`
   * to opt out of merging (e.g. non-adjacent inserts). The returned record
   * preserves `prev`'s `selection` and `coalesceKey` so the original
   * user-action category drives future merges.
   */
  readonly coalesce?: (
    prev: CoalescePair<unknown, unknown>,
    next: CoalescePair<unknown, unknown>,
  ) => CommandRecord | null
}

const COALESCE_WINDOW_MS = 500

/**
 * In-memory linear history of Commands. Bounded by `maxSize`.
 *
 * - `push` clears the future stack (branching).
 * - `pushCoalesced` merges into the previous past entry when the previous
 *   entry has the same `op` + `coalesceKey` and was pushed within
 *   `COALESCE_WINDOW_MS`. The merged record is produced by the record's own
 *   `coalesce` callback, which preserves the original selection/key.
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

      const pushCoalesced = (record: CommandRecord) =>
        SubscriptionRef.update(past, (arr) => {
          const prev = arr.length > 0 ? arr[arr.length - 1]! : null
          const eligible =
            !!prev &&
            !!record.coalesce &&
            prev.op === record.op &&
            prev.coalesceKey !== undefined &&
            record.coalesceKey !== undefined &&
            prev.coalesceKey === record.coalesceKey &&
            record.at - prev.at <= COALESCE_WINDOW_MS

          if (eligible) {
            const merged = record.coalesce!(
              { input: prev!.input, output: prev!.output },
              { input: record.input, output: record.output },
            )
            if (merged !== null) {
              return [...arr.slice(0, -1), merged]
            }
          }
          const next = [...arr, record]
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
      const futureChanges: Stream.Stream<ReadonlyArray<CommandRecord>> = future.changes

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
 * Classify the `reverseEffect` of a `CommandRecord` at runtime.
 */
export const reverseKind = (
  reverseEffect: CommandRecord["reverseEffect"],
): "function" | ReverseKind => {
  if (typeof reverseEffect === "function") return "function"
  return reverseEffect
}

/**
 * Narrow `reverseEffect` to the callable form, or return `null` if it is a
 * `ReverseKind` sentinel. Eliminates all casts at undo call-sites.
 */
export const getReverseFn = (
  reverseEffect: CommandRecord["reverseEffect"],
): ((editor: TiptapEditor, output: unknown) => Effect.Effect<void, unknown>) | null =>
  typeof reverseEffect === "function" ? reverseEffect : null
