import * as React from "react"
import type { NodeViewProps } from "../editor/internal/react-portal-registry"

export const NodeViewContext = React.createContext<NodeViewProps | null>(null)

/**
 * Read the current NodeView's props from inside a NodeView component.
 * Throws if called outside a NodeView.
 *
 * Returns the typed `attrs` (cast to the consumer's expected shape), the PM
 * `nodeType` name, the current `nodeSize`, a `getPos()` function (returns the
 * current position or `undefined` if the node was removed), a `selected`
 * boolean (true when the NodeView is the active node selection), and
 * `unsafe.node` — the raw PM Node — as an escape hatch for node-typed
 * operations not covered by attrs.
 */
export const useNodeViewProps = <Attrs = Record<string, unknown>,>(): {
  readonly attrs: Attrs
  readonly nodeType: string
  readonly nodeSize: number
  readonly getPos: () => number | undefined
  readonly selected: boolean
  readonly unsafe: { readonly node: unknown }
} => {
  const ctx = React.useContext(NodeViewContext)
  if (!ctx) {
    throw new Error("tiptap-effect: useNodeViewProps must be called inside a NodeView")
  }
  return {
    attrs: ctx.nodeAttrs as Attrs,
    nodeType: ctx.nodeType,
    nodeSize: ctx.nodeSize,
    getPos: ctx.getPos,
    selected: ctx.selected,
    unsafe: { node: ctx.unsafeNode },
  }
}

type NodeViewWrapperProps = React.HTMLAttributes<HTMLElement> & {
  readonly as?: keyof React.JSX.IntrinsicElements
}

export const NodeViewWrapper: React.FC<NodeViewWrapperProps> = ({
  as = "div",
  children,
  ...props
}) =>
  React.createElement(
    as,
    {
      ...props,
      "data-node-view-wrapper": "",
    },
    children,
  )
