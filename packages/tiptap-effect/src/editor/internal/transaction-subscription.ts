import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect } from "effect"
import type { EditorSchema } from "../../schema/define"
import { TransactionBus } from "../../runtime/internal/transaction-bus"
import { EditorContext } from "./context"
import { checkDocumentSchema } from "./document-validation"
import { makeSnapshot } from "./snapshot"
import type { EditorSchemaMarks, EditorSchemaNodes, SchemaMismatchPolicy } from "./types"

interface TiptapTransactionEvent {
  readonly transaction: {
    readonly docChanged: boolean
    readonly selectionSet: boolean
  }
  readonly editor: TiptapEditor
}

interface TiptapFocusEvent {
  readonly editor: TiptapEditor
}

const NO_TRANSACTION = { docChanged: false, selectionSet: false } as const
const INITIAL_SOURCE_META = ["init"] as const

const installedSubscriptions = new WeakMap<TiptapEditor, () => void>()

interface InstallOptions<
  N extends EditorSchemaNodes = EditorSchemaNodes,
  M extends EditorSchemaMarks = EditorSchemaMarks,
> {
  readonly onSchemaMismatch?: SchemaMismatchPolicy
  readonly schema?: EditorSchema<N, M>
}

export type {
  InstallOptions as TransactionSubscriptionOptions,
}

const installTransactionSubscription = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  options: InstallOptions<N, M> = {},
) =>
  Effect.gen(function* () {
    const bus = yield* TransactionBus
    const editorContext = yield* EditorContext
    const snapshotForEditor = yield* makeSnapshot()
    const editor = editorContext.editor
    if (installedSubscriptions.has(editor)) return

    const schema = options.schema
    const onSchemaMismatch = options.onSchemaMismatch ?? "log"
    const shouldCheckSchema =
      onSchemaMismatch !== "ignore" && schema !== undefined

    const checkSchema = (state: unknown) => {
      if (!shouldCheckSchema || schema === undefined) return
      const check = checkDocumentSchema(schema, state, onSchemaMismatch)
      if (onSchemaMismatch === "throw") {
        Effect.runSync(check)
      } else {
        Effect.runFork(check)
      }
    }

    const transactionHandler = (props: TiptapTransactionEvent) => {
      const snapshot = snapshotForEditor(props.transaction, props.editor.state)
      Effect.runFork(bus.push(snapshot.editorId, snapshot))

      checkSchema(snapshot.stateAfter)
    }

    const focusHandler = (props: TiptapFocusEvent) => {
      const snapshot = snapshotForEditor(NO_TRANSACTION, props.editor.state, {
        sourceMeta: ["focus"],
      })
      Effect.runFork(bus.push(snapshot.editorId, snapshot))
    }

    const blurHandler = (props: TiptapFocusEvent) => {
      const snapshot = snapshotForEditor(NO_TRANSACTION, props.editor.state, {
        sourceMeta: ["blur"],
      })
      Effect.runFork(bus.push(snapshot.editorId, snapshot))
    }

    editor.on("transaction", transactionHandler)
    editor.on("focus", focusHandler)
    editor.on("blur", blurHandler)

    const initialSnapshot = snapshotForEditor(NO_TRANSACTION, editor.state, {
      sourceMeta: INITIAL_SOURCE_META,
    })
    yield* bus.push(initialSnapshot.editorId, initialSnapshot)

    if (shouldCheckSchema && schema !== undefined) {
      yield* checkDocumentSchema(schema, initialSnapshot.stateAfter, onSchemaMismatch)
    }

    const cleanup = () => {
      editor.off("transaction", transactionHandler)
      editor.off("focus", focusHandler)
      editor.off("blur", blurHandler)
      installedSubscriptions.delete(editor)
    }
    installedSubscriptions.set(editor, cleanup)

    yield* Effect.addFinalizer(() =>
      Effect.sync(cleanup),
    )
  })

export { installTransactionSubscription, type TiptapTransactionEvent }
