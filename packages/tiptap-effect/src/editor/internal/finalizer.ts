import { Effect } from "effect"
import { CommandExecutor } from "../../command/command-executor"
import { TransactionBus } from "../../runtime/internal/transaction-bus"
import { EditorContext } from "./context"
import { destroyEditorOnce } from "./destroy-editor"
import type { NodeViewStore } from "./node-view-store"

const installEditorFinalizer = (nodeViewStore: NodeViewStore) =>
  Effect.gen(function* () {
    const { id, editor } = yield* EditorContext

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const bus = yield* TransactionBus
        const executor = yield* CommandExecutor

        yield* executor.interruptAllForEditor(editor)
        yield* Effect.sync(() => nodeViewStore.dispose())
        yield* Effect.sync(() => destroyEditorOnce(editor))
        yield* bus.dispose(id)
      }),
    )
  })

export { installEditorFinalizer }
