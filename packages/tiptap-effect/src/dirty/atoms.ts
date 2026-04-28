import { Effect, Stream } from "effect"
import { editorRuntime } from "../runtime"
import { TransactionBus } from "../runtime/internal/transaction-bus"
import type { EditorId } from "../types"
import { DirtyTracker } from "./internal/tracker"

/**
 * The doc JSON of the most recent `MarkSavedCommand` for `editorId`. `null`
 * until the first MarkSaved is dispatched.
 */
export const lastSavedAtom = (editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const tracker = yield* DirtyTracker
        return tracker.stream(editorId)
      }),
    ),
  )

type DirtyEvent =
  | { readonly tag: "doc"; readonly doc: unknown }
  | { readonly tag: "saved"; readonly doc: unknown }

/**
 * `true` when the doc has changed since the most recent `MarkSavedCommand`.
 *
 * Implementation: merges the per-editor TransactionBus + DirtyTracker streams
 * into one DirtyEvent stream and recomputes `JSON.stringify(doc) !==
 * JSON.stringify(lastSaved)` on every event. Before any MarkSaved has fired
 * the editor is considered dirty (consumer should `MarkSaved` at mount-time
 * to start clean).
 */
export const dirtyAtom = (editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const bus = yield* TransactionBus
        const tracker = yield* DirtyTracker

        const docStream: Stream.Stream<DirtyEvent> = bus
          .stream(editorId)
          .pipe(
            Stream.map((snap) => ({
              tag: "doc" as const,
              doc: (snap.stateAfter as { doc: { toJSON: () => unknown } }).doc.toJSON(),
            })),
          )

        const savedStream: Stream.Stream<DirtyEvent> = tracker
          .stream(editorId)
          .pipe(Stream.map((doc) => ({ tag: "saved" as const, doc })))

        let docJSON: unknown = null
        let savedJSON: unknown = null

        return Stream.merge(docStream, savedStream).pipe(
          Stream.map((evt) => {
            if (evt.tag === "doc") docJSON = evt.doc
            else savedJSON = evt.doc
            if (docJSON === null) return false
            if (savedJSON === null) return true
            return JSON.stringify(docJSON) !== JSON.stringify(savedJSON)
          }),
          Stream.changes,
        )
      }),
    ),
  )
