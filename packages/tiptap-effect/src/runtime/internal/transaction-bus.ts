import { Effect, Layer, Stream, SubscriptionRef } from "effect"
import type { EditorId, TransactionSnapshot } from "../../types"

/**
 * Per-editor transaction bus. Each editor pushes transaction snapshots into
 * its bus; slice atoms and reactive consumers subscribe to that stream.
 *
 * Implemented as a service holding a Map of `SubscriptionRef`s keyed by
 * `EditorId`. The bus entry is created lazily on first push or subscribe;
 * removal is the responsibility of the editor atom (see US-04).
 */
export class TransactionBus extends Effect.Service<TransactionBus>()(
  "tiptap-effect/TransactionBus",
  {
    effect: Effect.gen(function* () {
      const buses = new Map<
        EditorId,
        SubscriptionRef.SubscriptionRef<TransactionSnapshot | null>
      >()

      const getOrCreate = Effect.fnUntraced(function* (
        editorId: EditorId,
      ) {
        const existing = buses.get(editorId)
        if (existing) return existing
        const ref = yield* SubscriptionRef.make<TransactionSnapshot | null>(null)
        buses.set(editorId, ref)
        return ref
      })

      const push = Effect.fnUntraced(function* (
        editorId: EditorId,
        snapshot: TransactionSnapshot,
      ) {
        const ref = yield* getOrCreate(editorId)
        yield* SubscriptionRef.set(ref, snapshot)
      })

      const latest = Effect.fnUntraced(function* (
        editorId: EditorId,
      ) {
        const ref = yield* getOrCreate(editorId)
        return yield* SubscriptionRef.get(ref)
      })

      const stream = (
        editorId: EditorId,
      ): Stream.Stream<TransactionSnapshot> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const ref = yield* getOrCreate(editorId)
            return ref.changes.pipe(
              Stream.filter(
                (snap): snap is TransactionSnapshot => snap !== null,
              ),
            )
          }),
        )

      const dispose = (editorId: EditorId): Effect.Effect<void> =>
        Effect.sync(() => {
          buses.delete(editorId)
        })

      return {
        push,
        latest,
        stream,
        dispose,
      } as const
    }),
  },
) {}

/**
 * Default Layer providing the TransactionBus service.
 * Re-exported here so `TiptapLayer` can compose it.
 */
export const TransactionBusLive: Layer.Layer<TransactionBus> = TransactionBus.Default
