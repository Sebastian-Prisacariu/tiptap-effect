import { Result, useAtomValue } from "@effect-atom/atom-react"
import * as React from "react"
import * as ReactDOM from "react-dom"
import { useEditorScope } from "./EditorScope"
import { NodeViewContext } from "./NodeViewContext"
import type { NodeViewEntry, NodeViewStore } from "../editor/internal/node-view-store"

const useNodeViewEntries = (
  store: NodeViewStore | null,
): ReadonlyArray<NodeViewEntry> =>
  React.useSyncExternalStore(
    store ? store.subscribe : (() => () => {}),
    store ? store.getSnapshot : (() => emptyArray),
    () => emptyArray,
  )

const emptyArray: ReadonlyArray<NodeViewEntry> = Object.freeze([])

/**
 * Renders the editor's contenteditable into a managed `<div>` and renders
 * each active NodeView as a React Portal into the PM-managed DOM container.
 *
 * Portals keep NodeViews inside React's tree, so RegistryContext +
 * ScopedEditorContext flow naturally — `useDispatch` / `useEditorSlice` /
 * `useNodeViewProps` all work inside NodeView components.
 */
export const TiptapView: React.FC<{
  className?: string
  style?: React.CSSProperties
}> = ({ className, style }) => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const store = Result.isSuccess(result) ? result.value._internal.nodeViewStore : null
  const entries = useNodeViewEntries(store)

  const refCallback = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (!Result.isSuccess(result)) return
      result.value.mount(el)
    },
    [result],
  )

  return (
    <>
      <div ref={refCallback} className={className} style={style} />
      {entries.map((entry) => (
        <NodeViewPortal key={entry.key} entry={entry} />
      ))}
    </>
  )
}

const NodeViewPortal: React.FC<{ entry: NodeViewEntry }> = ({ entry }) => {
  const { Component } = entry
  return ReactDOM.createPortal(
    <NodeViewContext.Provider value={entry.props}>
      <Component />
    </NodeViewContext.Provider>,
    entry.dom,
  )
}
