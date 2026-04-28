import { Editor as TiptapEditor, type JSONContent } from "@tiptap/core"
import type { Extensions } from "@tiptap/core"
import { Effect } from "effect"
import { NodeViewStore } from "../react/internal/node-view-store"
import { editorRuntime } from "../runtime"
import type { NodeJSON } from "../schema/define"
import { decodeInitialContent } from "./internal/decode-initial-content"
import { installTransactionSubscription } from "./internal/transaction-subscription"
import { installEditableSubscription } from "./internal/editable-subscription"
import { installEditorFinalizer } from "./internal/finalizer"
import { makeEditorHandle } from "./internal/handle"
import { buildEditorExtensions } from "./internal/editor-extensions"
import { EditorContext } from "./internal/context"
import type { EditorSchemaNodes, EditorSchemaMarks, EditorSpec } from "./internal/types"
import { registerEditorId } from "../internal/editor-ids"

export { EditorInitError, type EditorSchemaNodes, type EditorSchemaMarks, type EditorSpec } from "./internal/types"
export {
  selectionAtom,
  selectedTextAtom,
  hasSelectionAtom,
  isCollapsedAtom,
  isActiveAtom,
  plainTextAtom,
  focusAtom,
  transactionBusAtom,
} from "./atoms"

export interface EditorHandle {
  readonly mount: (el: HTMLElement | null) => void
  readonly _internal: {
    readonly editor: TiptapEditor
    readonly nodeViewStore: NodeViewStore
  }
}

const createTiptapEditor = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
  extensions: Extensions,
  content: NodeJSON,
): TiptapEditor =>
  new TiptapEditor({
    element: null,
    extensions,
    editable: spec.editable ?? true,
    content: content as JSONContent,
    ...(spec.editorProps === undefined
      ? {}
      : { editorProps: spec.editorProps }),
  })

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
 */
export const makeEditorAtom = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
) =>
  editorRuntime.atom(
    Effect.gen(function* () {
      const content = yield* decodeInitialContent(spec)
      const nodeViewStore = new NodeViewStore()
      const extensions = buildEditorExtensions(spec, nodeViewStore)
      const editor = createTiptapEditor(spec, extensions, content)
      registerEditorId(editor, spec.id)

      return yield* Effect.gen(function* () {
        yield* installTransactionSubscription()
        yield* installEditableSubscription(spec.editableAtom)
        yield* installEditorFinalizer()

        return yield* makeEditorHandle(nodeViewStore)
      }).pipe(Effect.provideService(EditorContext, { id: spec.id, editor }))
    }),
  )
