import * as React from "react"
import type { NodeViewProps } from "./node-view-store.js"

export const NodeViewContext = React.createContext<NodeViewProps | null>(null)

/**
 * Read the current NodeView's props from inside a NodeView component.
 * Throws if called outside a NodeView.
 *
 * Returns the typed `attrs` (cast to the consumer's expected shape), the PM
 * `nodeType` name, a `getPos()` function (returns the current position or
 * `undefined` if the node was removed), and a `selected` boolean.
 */
export const useNodeViewProps = <Attrs = Record<string, unknown>,>(): {
  readonly attrs: Attrs
  readonly nodeType: string
  readonly getPos: () => number | undefined
  readonly selected: boolean
} => {
  const ctx = React.useContext(NodeViewContext)
  if (!ctx) {
    throw new Error("tiptap-effect: useNodeViewProps must be called inside a NodeView")
  }
  return {
    attrs: ctx.nodeAttrs as Attrs,
    nodeType: ctx.nodeType,
    getPos: ctx.getPos,
    selected: ctx.selected,
  }
}
