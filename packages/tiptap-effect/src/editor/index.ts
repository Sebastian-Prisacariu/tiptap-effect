import { Editor as TiptapEditor, type JSONContent } from "@tiptap/core"
import type { Extensions } from "@tiptap/core"
import { Effect } from "effect"
import { editorRuntime } from "../runtime"
import type { NodeJSON } from "../schema/define"
import { decodeInitialContent } from "./internal/decode-initial-content"
import {
  installTransactionSubscription,
  type TransactionSubscriptionOptions,
} from "./internal/transaction-subscription"
import { installEditableSubscription } from "./internal/editable-subscription"
import { installEditorPropsSubscription } from "./internal/editor-props-subscription"
import { installEditorFinalizer } from "./internal/finalizer"
import { makeEditorHandle } from "./internal/handle"
import { buildEditorExtensions } from "./internal/editor-extensions"
import { EditorContext } from "./internal/context"
import {
  EditorInitError,
  type EditorSchemaNodes,
  type EditorSchemaMarks,
  type EditorSpec,
} from "./internal/types"
import { registerEditorId } from "../internal/editor-ids"
import { NodeViewStore } from "./internal/node-view-store"
import { destroyEditorOnce } from "./internal/destroy-editor"

export {
  EditorInitError,
  SchemaCollisionError,
  type EditorSchemaNodes,
  type EditorSchemaMarks,
  type EditorSpec,
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

const createTiptapEditor = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
  extensions: Extensions,
  content: NodeJSON,
  editorProps: Record<string, unknown> | undefined,
): TiptapEditor =>
  new TiptapEditor({
    element: null,
    extensions,
    editable: spec.editable ?? true,
    content: content as JSONContent,
    ...(editorProps === undefined ? {} : { editorProps }),
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
  editorRuntime.atom((get) => {
    let editorRef: TiptapEditor | undefined

    get.addFinalizer(() => {
      const editor = editorRef
      if (editor === undefined) return
      destroyEditorOnce(editor)
    })

    return Effect.gen(function* () {
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

      const effectiveSpec: EditorSpec<N, M> =
        reactiveExtensions === undefined
          ? spec
          : { ...spec, extensions: reactiveExtensions }

      const content = yield* decodeInitialContent(effectiveSpec)
      const nodeViewStore = new NodeViewStore()
      const extensions = yield* buildEditorExtensions(
        effectiveSpec,
        nodeViewStore,
      ).pipe(Effect.mapError((cause) => new EditorInitError({ cause })))
      const editor = createTiptapEditor(
        effectiveSpec,
        extensions,
        content,
        reactiveEditorProps,
      )
      registerEditorId(editor, spec.id)
      editorRef = editor

      return yield* Effect.gen(function* () {
        const subscriptionOptions: TransactionSubscriptionOptions<N, M> = {
          devSchemaCheck: spec.devSchemaCheck === true,
          schema: spec.schema,
        }
        yield* installTransactionSubscription(subscriptionOptions)
        yield* installEditableSubscription(spec.editableAtom)
        yield* installEditorPropsSubscription(spec.editorPropsAtom)
        yield* installEditorFinalizer()

        return yield* makeEditorHandle(nodeViewStore)
      }).pipe(Effect.provideService(EditorContext, { id: spec.id, editor }))
    })
  })
