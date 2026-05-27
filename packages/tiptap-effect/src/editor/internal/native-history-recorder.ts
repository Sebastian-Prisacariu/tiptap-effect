import type { JSONContent, Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { Effect } from "effect"
import { CommandHistory, type CommandRecord } from "../../command/command-history"
import { restoreDocumentSnapshot } from "../../command/internal/document-patch-contract"
import {
  isCommandOriginActive,
  isHistoryRestoreActive,
  shouldRecordNativeHistory,
} from "../../command/internal/transaction-origin"
import { EditorContext } from "./context"

export interface NativeTransactionEvent {
  readonly transaction: Transaction
  readonly editor: TiptapEditor
}

interface NativeDocumentChange {
  readonly before: JSONContent
  readonly after: JSONContent
}

const NATIVE_DOCUMENT_OP = "tiptap-effect.native-document-change"

const sameJson = (left: JSONContent, right: JSONContent): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const makeNativeRecord = (
  editorId: CommandRecord["editorId"],
  before: JSONContent,
  after: JSONContent,
  at: number,
): CommandRecord => {
  const output: NativeDocumentChange = { before, after }

  return {
    editorId,
    op: NATIVE_DOCUMENT_OP,
    input: undefined,
    output,
    at,
    forwardEffect: (editor) =>
      restoreDocumentSnapshot(editor, after).pipe(Effect.as(output)),
    reverseEffect: (editor, currentOutput) => {
      const change = currentOutput as NativeDocumentChange
      return restoreDocumentSnapshot(editor, change.before)
    },
  }
}

const docBeforeTransaction = (tr: Transaction): JSONContent =>
  (tr.before as ProseMirrorNode).toJSON() as JSONContent

export const makeNativeHistoryRecorder: () => Effect.Effect<
  (props: NativeTransactionEvent) => void,
  never,
  CommandHistory | EditorContext
> = Effect.fnUntraced(function* () {
    const history = yield* CommandHistory
    const { id } = yield* EditorContext

    return (props: NativeTransactionEvent) => {
      const tr = props.transaction
      if (isCommandOriginActive(props.editor) || isHistoryRestoreActive(props.editor)) {
        return
      }
      if (!shouldRecordNativeHistory(tr)) return

      const before = docBeforeTransaction(tr)
      const after = props.editor.state.doc.toJSON() as JSONContent
      if (sameJson(before, after)) return

      const record = makeNativeRecord(id, before, after, Date.now())
      Effect.runFork(history.pushCoalesced(id, record))
    }
  })
