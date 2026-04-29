import { Effect } from "effect"
import type { TransactionSnapshot } from "../../types"
import { EditorContext } from "./context"

type SnapshotTransaction = {
  readonly docChanged: boolean
  readonly selectionSet: boolean
}

type SnapshotOptions = {
  readonly sourceMeta?: ReadonlyArray<string>
}

const makeSnapshot = (): Effect.Effect<
  (
    transaction: SnapshotTransaction,
    state: unknown,
    options?: SnapshotOptions,
  ) => TransactionSnapshot,
  never,
  EditorContext
> =>
  Effect.map(EditorContext, ({ id }) => (transaction, state, options) => ({
    editorId: id,
    docChanged: transaction.docChanged,
    selectionSet: transaction.selectionSet,
    stateAfter: state,
    transaction,
    sourceMeta: options?.sourceMeta ?? [],
    at: Date.now(),
  }))

export { makeSnapshot, type SnapshotTransaction, type SnapshotOptions }
