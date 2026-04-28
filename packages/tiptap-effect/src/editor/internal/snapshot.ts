import { Effect } from "effect"
import type { TransactionSnapshot } from "../../types"
import { EditorContext } from "./context"

type SnapshotTransaction = {
  readonly docChanged: boolean
  readonly selectionSet: boolean
}

const makeSnapshot = (): Effect.Effect<
  (transaction: SnapshotTransaction, state: unknown) => TransactionSnapshot,
  never,
  EditorContext
> =>
  Effect.map(EditorContext, ({ id }) => (transaction, state) => ({
    editorId: id,
    docChanged: transaction.docChanged,
    selectionSet: transaction.selectionSet,
    stateAfter: state,
    transaction,
    sourceMeta: [],
    at: Date.now(),
  }))

export { makeSnapshot }
