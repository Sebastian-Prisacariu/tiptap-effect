import type { Registry } from "@effect-atom/atom"
import { Effect, Scope } from "effect"
import { CommandExecutor } from "../../command/command-executor"
import { CommandHistory } from "../../command/command-history"
import { TransactionBus } from "../../runtime/internal/transaction-bus"
import { EditorContext } from "./context"
import { installEditableSubscription } from "./editable-subscription"
import { installEditorPropsSubscription } from "./editor-props-subscription"
import { makeEditorHandle, type EditorHandle } from "./handle"
import {
  acquireBootedEditor,
  type ReactiveEditorInputs,
} from "./booted-editor"
import {
  installTransactionSubscription,
  type TransactionSubscriptionOptions,
} from "./transaction-subscription"
import {
  EditorInitError,
  type EditorSchemaMarks,
  type EditorSchemaNodes,
  type EditorSpec,
} from "./types"

export interface EditorSessionInput<
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
> {
  readonly spec: EditorSpec<N, M>
  readonly reactive: ReactiveEditorInputs
}

/**
 * One live editor lifetime: booted Tiptap editor, session subscriptions,
 * NodeView store ownership, mount handle, and Scope-bound release.
 */
export interface EditorSession {
  readonly handle: EditorHandle
}

const installSessionReactivity = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
): Effect.Effect<
  void,
  EditorInitError,
  CommandHistory | TransactionBus | Scope.Scope | EditorContext | Registry.AtomRegistry
> =>
  Effect.gen(function* () {
    const subscriptionOptions: TransactionSubscriptionOptions<N, M> = {
      onSchemaMismatch: spec.onSchemaMismatch ?? "log",
      schema: spec.schema,
    }
    yield* installTransactionSubscription(subscriptionOptions).pipe(
      Effect.mapError((cause) => new EditorInitError({ cause })),
    )
    yield* installEditableSubscription(spec.editableAtom)
    yield* installEditorPropsSubscription(spec.editorPropsAtom)
  })

const bootEditorSession = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>({
  spec,
  reactive,
}: EditorSessionInput<N, M>): Effect.Effect<
  EditorSession,
  EditorInitError,
  CommandExecutor | CommandHistory | TransactionBus | Scope.Scope | Registry.AtomRegistry
> =>
  Effect.gen(function* () {
    const booted = yield* acquireBootedEditor({ spec, reactive })
    const session = yield* Effect.gen(function* () {
      yield* installSessionReactivity(spec)
      const handle = yield* makeEditorHandle(booted.reactPortals)
      return { handle } as const
    }).pipe(
      Effect.provideService(EditorContext, {
        id: spec.id,
        editor: booted.editor,
      }),
    )
    return session
  })

/**
 * Acquire exactly one editor session. Rebuild policy stays with makeEditorAtom;
 * this module owns everything that must be true while that one editor is alive.
 */
export const acquireEditorSession = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  input: EditorSessionInput<N, M>,
): Effect.Effect<
  EditorSession,
  EditorInitError,
  CommandExecutor | CommandHistory | TransactionBus | Scope.Scope | Registry.AtomRegistry
> => bootEditorSession(input)
