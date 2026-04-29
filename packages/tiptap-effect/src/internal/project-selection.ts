import {
  AllSelection,
  NodeSelection,
  type EditorState,
  type Selection,
} from "@tiptap/pm/state"
import type { SelectionInfo } from "../schema/selection"

/**
 * Project a ProseMirror EditorState's selection into the public, Schema-typed
 * SelectionInfo. Kept internal so PM types don't leak into consumers.
 */
type PublicSelection = Selection & {
  readonly head?: number
  readonly empty: boolean
}

export const projectSelection = (state: EditorState | unknown): SelectionInfo => {
  const sel = (state as EditorState).selection as PublicSelection
  const ctorName = sel.constructor?.name
  if (sel instanceof AllSelection) {
    return { kind: "all", from: sel.from, to: sel.to }
  }
  if (sel instanceof NodeSelection) {
    return {
      kind: "node",
      pos: sel.from,
      nodeType: sel.node?.type?.name ?? "unknown",
    }
  }
  if (ctorName === "GapCursor") {
    return { kind: "gap", pos: sel.from }
  }
  return {
    kind: "text",
    from: sel.from,
    to: sel.to,
    head: sel.head ?? sel.to,
    empty: sel.empty,
  }
}
