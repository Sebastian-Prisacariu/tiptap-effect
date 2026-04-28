import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect, Stream, SubscriptionRef } from "effect"
import type { CoalescePair, ReverseKind } from "./command"
import type { SelectionInfo } from "../schema/selection"
import type { EditorId } from "../types"

/**
 * A record kept in the live undo/redo stacks.
 *
 * `forwardEffect` re-runs the command's forward for redo.
 * `reverseEffect` undoes the command; it receives the *current* stored
 * `output` so that redo-then-undo always operates on the freshest output
 * rather than a stale closure value.
 */
export interface CommandRecord {
  readonly editorId: EditorId
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

interface HistoryState {
  readonly past: SubscriptionRef.SubscriptionRef<ReadonlyArray<CommandRecord>>
  readonly future: SubscriptionRef.SubscriptionRef<ReadonlyArray<CommandRecord>>
}

/**
 * Per-editor in-memory linear history of Commands. Each stack is bounded by
 * `maxSize`.
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
      const states = new Map<EditorId, HistoryState>()
      const maxSize = 1000

      const getState = (editorId: EditorId): Effect.Effect<HistoryState> =>
        Effect.gen(function* () {
          const existing = states.get(editorId)
          if (existing) return existing
          const past = yield* SubscriptionRef.make<ReadonlyArray<CommandRecord>>([])
          const future = yield* SubscriptionRef.make<ReadonlyArray<CommandRecord>>([])
          const state = { past, future } satisfies HistoryState
          states.set(editorId, state)
          return state
        })

      const pushPreserveFuture = (editorId: EditorId, record: CommandRecord) =>
        Effect.flatMap(getState(editorId), ({ past }) =>
          SubscriptionRef.update(past, (arr) => {
            const next = [...arr, record]
            return next.length > maxSize ? next.slice(next.length - maxSize) : next
          }),
        )

      const push = (editorId: EditorId, record: CommandRecord) =>
        Effect.flatMap(getState(editorId), ({ future }) =>
          pushPreserveFuture(editorId, record).pipe(
            Effect.zipRight(SubscriptionRef.set(future, [])),
          ),
        )

      const pushCoalesced = (editorId: EditorId, record: CommandRecord) =>
        Effect.flatMap(getState(editorId), ({ past, future }) =>
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
          }).pipe(Effect.zipRight(SubscriptionRef.set(future, []))),
        )

      const popLast = (editorId: EditorId): Effect.Effect<CommandRecord | null> =>
        Effect.flatMap(getState(editorId), ({ past }) =>
          SubscriptionRef.modify(past, (arr): [CommandRecord | null, ReadonlyArray<CommandRecord>] => {
            if (arr.length === 0) return [null, arr]
            const last = arr[arr.length - 1]!
            return [last, arr.slice(0, -1)]
          }),
        )

      const pushFuture = (editorId: EditorId, record: CommandRecord) =>
        Effect.flatMap(getState(editorId), ({ future }) =>
          SubscriptionRef.update(future, (arr) => [...arr, record]),
        )

      const popFuture = (editorId: EditorId): Effect.Effect<CommandRecord | null> =>
        Effect.flatMap(getState(editorId), ({ future }) =>
          SubscriptionRef.modify(future, (arr): [CommandRecord | null, ReadonlyArray<CommandRecord>] => {
            if (arr.length === 0) return [null, arr]
            const last = arr[arr.length - 1]!
            return [last, arr.slice(0, -1)]
          }),
        )

      const list = (editorId: EditorId) =>
        Effect.flatMap(getState(editorId), ({ past }) => SubscriptionRef.get(past))

      const clear = (editorId: EditorId) =>
        Effect.flatMap(getState(editorId), ({ past, future }) =>
          SubscriptionRef.set(past, []).pipe(
            Effect.zipRight(SubscriptionRef.set(future, [])),
          ),
        )

      const pastChanges = (editorId: EditorId): Stream.Stream<ReadonlyArray<CommandRecord>> =>
        Stream.unwrap(Effect.map(getState(editorId), ({ past }) => past.changes))

      const futureChanges = (editorId: EditorId): Stream.Stream<ReadonlyArray<CommandRecord>> =>
        Stream.unwrap(Effect.map(getState(editorId), ({ future }) => future.changes))

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
