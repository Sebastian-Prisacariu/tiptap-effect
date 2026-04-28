import { Effect, Layer, Stream, SubscriptionRef } from "effect"
import type { EditorId } from "../../types"

/**
 * Per-editor "last saved" doc JSON tracker. `MarkSavedCommand` writes into this
 * service; `dirtyAtom` derives `current.doc !== lastSaved.doc` from it.
 *
 * Keyed by `EditorId`. The `SubscriptionRef` stays alive for the lifetime of
 * the runtime because dirty state is a UX concern that benefits from surviving
 * brief editor recreates, such as StrictMode unmount-remount cycles.
 */
export class DirtyTracker extends Effect.Service<DirtyTracker>()(
  "tiptap-effect/DirtyTracker",
  {
    effect: Effect.gen(function* () {
      const refs = new Map<EditorId, SubscriptionRef.SubscriptionRef<unknown>>()

      const get = (id: EditorId): Effect.Effect<SubscriptionRef.SubscriptionRef<unknown>> =>
        Effect.gen(function* () {
          const existing = refs.get(id)
          if (existing) return existing
          const ref = yield* SubscriptionRef.make<unknown>(null)
          refs.set(id, ref)
          return ref
        })

      const markSaved = (id: EditorId, doc: unknown) =>
        Effect.flatMap(get(id), (ref) => SubscriptionRef.set(ref, doc))

      const lastSaved = (id: EditorId): Effect.Effect<unknown> =>
        Effect.flatMap(get(id), (ref) => SubscriptionRef.get(ref))

      const stream = (id: EditorId): Stream.Stream<unknown> =>
        Stream.unwrap(Effect.map(get(id), (ref) => ref.changes))

      return {
        markSaved,
        lastSaved,
        stream,
      } as const
    }),
  },
) {}

export const DirtyTrackerLive: Layer.Layer<DirtyTracker> = DirtyTracker.Default
