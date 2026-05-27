import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect } from "effect"
import { editorRuntime } from "../runtime"
import {
  EditorInitError,
  type EditorSchemaNodes,
  type EditorSchemaMarks,
  type EditorSpec,
} from "./internal/types"
import type { ReactiveEditorInputs } from "./internal/booted-editor"
import { acquireEditorSession } from "./internal/editor-session"
import type { NodeViewStore } from "./internal/node-view-store"

export {
  EditorInitError,
  SchemaCollisionError,
  type EditorSchemaNodes,
  type EditorSchemaMarks,
  type EditorSpec,
  type SchemaMismatchPolicy,
} from "./internal/types"
export {
  selectionAtom,
  selectedTextAtom,
  hasSelectionAtom,
  isCollapsedAtom,
  isActiveAtom,
  selectedNodeAtom,
  canExecuteAtom,
  plainTextAtom,
  focusAtom,
  transactionBusAtom,
  docAtom,
  htmlAtom,
  type SelectedNodeInfo,
} from "./atoms"

export interface EditorHandle {
  readonly mount: (el: HTMLElement | null) => void
  readonly _internal: {
    readonly editor: TiptapEditor
    readonly nodeViewStore: NodeViewStore
  }
}

/**
 * Create the atom that owns a single Tiptap editor instance.
 *
 * - Validates `defaultContent` against `spec.schema.Document` at construction.
 * - Builds the editor with `element: null` (mounted via the returned handle).
 * - Wires exactly one `transaction` listener that pushes snapshots to the
 *   per-editor `TransactionBus`.
 * - Registers `editor.destroy()` as a Scope finalizer — runs exactly once on
 *   atom disposal.
 * - If `spec.editableAtom` is provided, subscribes imperatively so flipping
 *   the atom calls `editor.setEditable(x, false)` without rebuilding.
 * - If `spec.extensionsAtom` is provided, the editor REBUILDS on each new
 *   value (PM schema is fixed at construction). The `(get) => effect` form
 *   below makes the atom react to upstream changes and the surrounding
 *   atom-Scope tears down the previous editor before the new one boots.
 * - If `spec.editorPropsAtom` is provided, calls `editor.setOptions({
 *   editorProps })` per emission — surgical update, no rebuild.
 */
export const makeEditorAtom = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
) =>
  editorRuntime.atom((get) =>
    Effect.gen(function* () {
      // extensionsAtom is read with `get(...)` — establishing a reactive
      // dependency so changes trigger a rebuild. editorPropsAtom uses
      // `get.once(...)` — read for the initial value but no dependency,
      // because installEditorPropsSubscription handles reactive updates
      // via editor.setOptions (no rebuild).
      const reactiveExtensions =
        spec.extensionsAtom !== undefined ? get(spec.extensionsAtom) : undefined
      const reactiveEditorProps =
        spec.editorPropsAtom !== undefined
          ? get.once(spec.editorPropsAtom)
          : spec.editorProps
      const initialEditable =
        spec.editableAtom !== undefined
          ? get.once(spec.editableAtom)
          : spec.editable ?? true
      const reactive: ReactiveEditorInputs = {
        extensions: reactiveExtensions,
        editorProps: reactiveEditorProps,
        editable: initialEditable,
      }
      const session = yield* acquireEditorSession({ spec, reactive })
      return session.handle
    })
  )
