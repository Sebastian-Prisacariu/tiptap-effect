import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect } from "effect"
import { TransactionBus } from "../../runtime/internal/transaction-bus"
import { EditorContext } from "./context"
import { makeSnapshot } from "./snapshot"

interface TiptapTransactionEvent {
  readonly transaction: {
    readonly docChanged: boolean
    readonly selectionSet: boolean
  }
  readonly editor: TiptapEditor
}

const installTransactionSubscription = () =>
  Effect.gen(function* () {
    const bus = yield* TransactionBus
    const editorContext = yield* EditorContext
    const snapshotForEditor = yield* makeSnapshot()

    const handler = (props: TiptapTransactionEvent) => {
      const snapshot = snapshotForEditor(
        props.transaction,
        props.editor.state,
      )
      Effect.runFork(bus.push(snapshot.editorId, snapshot))
    }

    editorContext.editor.on("transaction", handler)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => editorContext.editor.off("transaction", handler)),
    )
  })

export { installTransactionSubscription, type TiptapTransactionEvent }
