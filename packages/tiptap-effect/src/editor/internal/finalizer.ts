import { Effect } from "effect"
import { CommandExecutor } from "../../command/command-executor"
import { TransactionBus } from "../../runtime/internal/transaction-bus"
import { EditorContext } from "./context"

const installEditorFinalizer = () =>
  Effect.gen(function* () {
    const { id, editor } = yield* EditorContext

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const bus = yield* TransactionBus
        const executor = yield* CommandExecutor

        yield* executor.interruptAllForEditor(editor)
        if (!editor.isDestroyed) editor.destroy()
        yield* bus.dispose(id)
      }),
    )
  })

export { installEditorFinalizer }
