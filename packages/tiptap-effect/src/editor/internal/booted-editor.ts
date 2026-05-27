import { Editor as TiptapEditor, type Extensions, type JSONContent } from "@tiptap/core"
import { Effect, Scope } from "effect"
import { CommandExecutor } from "../../command/command-executor"
import { registerEditorId } from "../../internal/editor-ids"
import { TransactionBus } from "../../runtime/internal/transaction-bus"
import type { NodeJSON } from "../../schema/define"
import type { EditorId } from "../../types"
import { decodeInitialContent } from "./decode-initial-content"
import { destroyEditorOnce } from "./destroy-editor"
import { buildEditorExtensions } from "./editor-extensions"
import {
  NodeViewStore,
  registerNodeViewStoreForEditorView,
  withNodeViewStoreForEditorConstruction,
} from "./node-view-store"
import {
  EditorInitError,
  type EditorSchemaMarks,
  type EditorSchemaNodes,
  type EditorSpec,
} from "./types"

export interface ReactiveEditorInputs {
  readonly extensions?: Extensions
  readonly editorProps?: Record<string, unknown>
  readonly editable: boolean
}

export interface EditorBootInput<
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
> {
  readonly spec: EditorSpec<N, M>
  readonly reactive: ReactiveEditorInputs
}

export interface BootedEditor {
  readonly id: EditorId
  readonly editor: TiptapEditor
  readonly nodeViewStore: NodeViewStore
  readonly unregisterConstructedViewStore: () => void
}

const createTiptapEditor = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
  extensions: Extensions,
  content: NodeJSON,
  editable: boolean,
  editorProps: Record<string, unknown> | undefined,
  nodeViewStore: NodeViewStore,
): TiptapEditor =>
  withNodeViewStoreForEditorConstruction(
    nodeViewStore,
    () =>
      new TiptapEditor({
        element: null,
        extensions,
        editable,
        content: content as JSONContent,
        ...(editorProps === undefined ? {} : { editorProps }),
      }),
  )

const cleanupPartialBoot = (
  nodeViewStore: NodeViewStore,
  editor: TiptapEditor | undefined,
  unregisterConstructedViewStore: (() => void) | undefined,
): void => {
  unregisterConstructedViewStore?.()
  nodeViewStore.dispose()
  if (editor !== undefined) {
    destroyEditorOnce(editor)
  }
}

export const bootEditor = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>({
  spec,
  reactive,
}: EditorBootInput<N, M>): Effect.Effect<BootedEditor, EditorInitError> =>
  Effect.gen(function* () {
    const effectiveSpec: EditorSpec<N, M> =
      reactive.extensions === undefined
        ? spec
        : { ...spec, extensions: reactive.extensions }
    const nodeViewStore = new NodeViewStore()
    let editor: TiptapEditor | undefined
    let unregisterConstructedViewStore: (() => void) | undefined

    return yield* Effect.gen(function* () {
      const content = yield* decodeInitialContent(effectiveSpec)
      const extensions = yield* buildEditorExtensions(
        effectiveSpec,
        nodeViewStore,
      ).pipe(Effect.mapError((cause) => new EditorInitError({ cause })))

      editor = createTiptapEditor(
        effectiveSpec,
        extensions,
        content,
        reactive.editable,
        reactive.editorProps,
        nodeViewStore,
      )
      registerEditorId(editor, spec.id)
      unregisterConstructedViewStore = registerNodeViewStoreForEditorView(
        editor.view,
        nodeViewStore,
      )

      return {
        id: spec.id,
        editor,
        nodeViewStore,
        unregisterConstructedViewStore,
      } as const
    }).pipe(
      Effect.tapErrorCause(() =>
        Effect.sync(() =>
          cleanupPartialBoot(
            nodeViewStore,
            editor,
            unregisterConstructedViewStore,
          ),
        ),
      ),
    )
  })

export const releaseBootedEditor = (
  booted: BootedEditor,
): Effect.Effect<void, never, CommandExecutor | TransactionBus> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor
    const bus = yield* TransactionBus

    yield* executor.interruptAllForEditor(booted.editor)
    yield* Effect.sync(() => booted.unregisterConstructedViewStore())
    yield* Effect.sync(() => booted.nodeViewStore.dispose())
    yield* Effect.sync(() => destroyEditorOnce(booted.editor))
    yield* bus.dispose(booted.id)
  })

export const acquireBootedEditor = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  input: EditorBootInput<N, M>,
): Effect.Effect<BootedEditor, EditorInitError, CommandExecutor | TransactionBus | Scope.Scope> =>
  Effect.acquireRelease(bootEditor(input), releaseBootedEditor)
