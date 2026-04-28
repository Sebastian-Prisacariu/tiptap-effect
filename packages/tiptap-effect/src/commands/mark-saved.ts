import { Effect, Schema } from "effect"
import { defineCommand, Reverse } from "../command.js"
import { CurrentEditor } from "../current-editor.js"
import { DirtyTracker } from "../dirty-tracker.js"
import type { EditorId } from "../types.js"

/**
 * Snapshot the current doc into the per-editor `lastSavedAtom` (i.e. flip the
 * `dirtyAtom` to `false`). Use after a successful save round-trip so the UI
 * can hide the "unsaved changes" indicator.
 *
 * Marked `Reverse.skipOnUndo` because "saved" is a UX milestone, not a doc
 * mutation — undoing past it would be confusing (the user pressed Cmd-Z to
 * undo their typing, not to "un-save"). The history pointer silently advances.
 *
 * This is a *factory* (parameterised by `editorId`) because the executor
 * doesn't carry an `EditorId` in `CurrentEditor`; the factory closes over it.
 */
export const MarkSavedCommand = (editorId: EditorId) =>
  defineCommand({
    op: "tiptap-effect.mark-saved" as const,
    description: () => "Mark saved",
    inputSchema: Schema.Void,
    outputSchema: Schema.Struct({ savedJSON: Schema.Unknown }),
    forward: () =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor
        const tracker = yield* DirtyTracker
        const json = editor.state.doc.toJSON()
        yield* tracker.markSaved(editorId, json)
        return { savedJSON: json }
      }),
    reverse: Reverse.skipOnUndo,
  })
