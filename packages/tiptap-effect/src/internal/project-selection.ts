import type { SelectionInfo } from "../schema/selection.js"

/**
 * Project a ProseMirror EditorState's selection into the public, Schema-typed
 * SelectionInfo. Kept internal so PM types don't leak into consumers.
 */
export const projectSelection = (state: unknown): SelectionInfo => {
  const sel = (state as { selection: any }).selection
  const ctorName = sel.constructor?.name
  if (ctorName === "AllSelection") {
    return { kind: "all", from: sel.from, to: sel.to }
  }
  if (ctorName === "NodeSelection") {
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
    head: sel.head,
    empty: sel.empty,
  }
}
