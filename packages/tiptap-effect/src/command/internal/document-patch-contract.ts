import type { JSONContent, Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorState } from "@tiptap/pm/state"
import { Effect } from "effect"
import { tagHistoryRestore, withHistoryRestore } from "./transaction-origin"

export interface PreviousDocumentOutput<Document> {
  readonly previousContent: Document
}

export const currentDocumentFromState = <Document>(
  state: EditorState,
): Document => state.doc.toJSON() as Document

export const capturePreviousDocument = <Document>(
  state: EditorState,
): PreviousDocumentOutput<Document> => ({
  previousContent: currentDocumentFromState<Document>(state),
})

export const mergePreviousDocumentOutput = <
  Document,
  Extra extends Record<string, unknown>,
>(
  previous: PreviousDocumentOutput<Document>,
  extra: Extra | void,
): PreviousDocumentOutput<Document> & Extra => {
  if (extra && typeof extra === "object") {
    return { ...previous, ...extra } as PreviousDocumentOutput<Document> & Extra
  }
  return previous as PreviousDocumentOutput<Document> & Extra
}

export const restoreDocumentSnapshot = (
  editor: TiptapEditor,
  content: JSONContent,
): Effect.Effect<void> =>
  withHistoryRestore(
    editor,
    Effect.sync(() => {
      const next = editor.schema.nodeFromJSON(content) as ProseMirrorNode
      const tr = editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        next.content,
      )
      editor.view.dispatch(tagHistoryRestore(tr))
    }),
  )

export const orderMatchesDescending = <
  Match extends { readonly from: number },
>(
  matches: ReadonlyArray<Match>,
): ReadonlyArray<Match> => [...matches].sort((a, b) => b.from - a.from)
