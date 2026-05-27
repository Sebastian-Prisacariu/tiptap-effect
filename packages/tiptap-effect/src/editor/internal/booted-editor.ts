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
  ReactPortalRegistry,
  registerReactPortalRegistryForEditorView,
  withReactPortalRegistryForEditorConstruction,
} from "./react-portal-registry"
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
  readonly reactPortals: ReactPortalRegistry
  readonly unregisterConstructedPortalRegistry: () => void
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
  reactPortals: ReactPortalRegistry,
): TiptapEditor =>
  withReactPortalRegistryForEditorConstruction(
    reactPortals,
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
  reactPortals: ReactPortalRegistry,
  editor: TiptapEditor | undefined,
  unregisterConstructedPortalRegistry: (() => void) | undefined,
): void => {
  unregisterConstructedPortalRegistry?.()
  reactPortals.dispose()
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
    const reactPortals = new ReactPortalRegistry()
    let editor: TiptapEditor | undefined
    let unregisterConstructedPortalRegistry: (() => void) | undefined

    return yield* Effect.gen(function* () {
      const content = yield* decodeInitialContent(effectiveSpec)
      const extensions = yield* buildEditorExtensions(
        effectiveSpec,
        reactPortals,
      ).pipe(Effect.mapError((cause) => new EditorInitError({ cause })))

      editor = createTiptapEditor(
        effectiveSpec,
        extensions,
        content,
        reactive.editable,
        reactive.editorProps,
        reactPortals,
      )
      registerEditorId(editor, spec.id)
      unregisterConstructedPortalRegistry = registerReactPortalRegistryForEditorView(
        editor.view,
        reactPortals,
      )

      return {
        id: spec.id,
        editor,
        reactPortals,
        unregisterConstructedPortalRegistry,
      } as const
    }).pipe(
      Effect.tapErrorCause(() =>
        Effect.sync(() =>
          cleanupPartialBoot(
            reactPortals,
            editor,
            unregisterConstructedPortalRegistry,
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
    yield* Effect.sync(() => booted.unregisterConstructedPortalRegistry())
    yield* Effect.sync(() => booted.reactPortals.dispose())
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
