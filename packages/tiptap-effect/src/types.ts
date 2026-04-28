import { Brand } from "effect"

/**
 * A stable identifier for a single editor instance.
 *
 * Brand-typed so it can't be confused with arbitrary strings. Use
 * `EditorId.make("course-123")` to construct.
 */
export type EditorId = string & Brand.Brand<"EditorId">
export const EditorId = Brand.nominal<EditorId>()

/**
 * A snapshot pushed onto the transaction bus after each PM transaction.
 *
 * The transaction object itself is opaque — slice atoms read from
 * `stateAfter` (the new EditorState) rather than walking the transaction.
 * Specific fields (docChanged, selectionSet, sourceMeta) are exposed for
 * fast-path filtering without importing PM types into consumers' code.
 */
export interface TransactionSnapshot {
  readonly editorId: EditorId
  readonly docChanged: boolean
  readonly selectionSet: boolean
  readonly stateAfter: unknown // ProseMirror EditorState — opaque at this layer
  readonly transaction: unknown // ProseMirror Transaction — opaque at this layer
  readonly sourceMeta: ReadonlyArray<string>
  readonly at: number
}
