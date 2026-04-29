import { Result, useAtomValue } from "@effect-atom/atom-react"
import { RegistryContext } from "@effect-atom/atom-react"
import * as React from "react"
import * as ReactDOMClient from "react-dom/client"
import { ScopedEditorContext, useEditorScope } from "./EditorScope"
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
 * each active NodeView/decorator as a child React root in the PM-managed DOM.
 *
 * TiptapView re-provides RegistryContext + ScopedEditorContext into each root,
 * so `useDispatch` / `useEditorSlice` / `useNodeViewProps` work inside
 * NodeView components.
 */
export const TiptapView: React.FC<{
  className?: string
  style?: React.CSSProperties
}> = ({ className, style }) => {
  const editorScope = useEditorScope()
  const registry = React.useContext(RegistryContext)
  const { atom } = editorScope
  const result = useAtomValue(atom)
  const store = Result.isSuccess(result) ? result.value._internal.nodeViewStore : null
  const entries = useNodeViewEntries(store)
  const handleRef = React.useRef(Result.isSuccess(result) ? result.value : null)
  const hostRef = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    handleRef.current = Result.isSuccess(result) ? result.value : null
    if (hostRef.current) handleRef.current?.mount(hostRef.current)
  }, [result])

  const refCallback = React.useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el
    handleRef.current?.mount(el)
  }, [])

  return (
    <>
      <div ref={refCallback} className={className} style={style} />
      {entries.map((entry) => (
        <NodeViewRoot
          key={entry.key}
          entry={entry}
          registry={registry}
          editorScope={editorScope}
          store={store}
        />
      ))}
    </>
  )
}

const NodeViewRoot: React.FC<{
  entry: NodeViewEntry
  registry: React.ContextType<typeof RegistryContext>
  editorScope: React.ContextType<typeof ScopedEditorContext>
  store: NodeViewStore | null
}> = ({ entry, registry, editorScope, store }) => {
  const { Component } = entry
  const rootRef = React.useRef<ReactDOMClient.Root | null>(null)
  const rootAliveRef = React.useRef(false)

  const content = (
    <RegistryContext.Provider value={registry}>
      <ScopedEditorContext.Provider value={editorScope}>
        {entry.props ? (
          <NodeViewContext.Provider value={entry.props}>
            <Component {...entry.componentProps} />
          </NodeViewContext.Provider>
        ) : (
          <Component {...entry.componentProps} />
        )}
      </ScopedEditorContext.Provider>
    </RegistryContext.Provider>
  )

  React.useLayoutEffect(() => {
    const root = rootRef.current ?? ReactDOMClient.createRoot(entry.dom)
    rootRef.current = root
    rootAliveRef.current = true
    const unmount = () => {
      if (!rootAliveRef.current) return
      rootAliveRef.current = false
      root.unmount()
      if (rootRef.current === root) rootRef.current = null
    }
    store?.setUnmount(entry.key, unmount)
    return () => {}
  }, [entry.dom, entry.key, store])

  React.useLayoutEffect(() => {
    rootRef.current?.render(content)
  })

  return null
}
