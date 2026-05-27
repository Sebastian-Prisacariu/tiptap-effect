import { Result, useAtomValue } from "@effect-atom/atom-react"
import { RegistryContext } from "@effect-atom/atom-react"
import { Effect } from "effect"
import * as React from "react"
import { ScopedEditorContext, useEditorScope } from "./EditorScope"
import { NodeViewContext } from "./NodeViewContext"
import type { NodeViewEntry, NodeViewStore } from "../editor/internal/node-view-store"
import {
  acquireReactRoot,
  type MountedReactRoot,
} from "./internal/react-root-resource"
import { runScopedResourceSync } from "./internal/scoped-resource"

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
  renderNodeViewProviders?: (children: React.ReactNode) => React.ReactNode
  style?: React.CSSProperties
}> = ({ className, renderNodeViewProviders, style }) => {
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
          renderNodeViewProviders={renderNodeViewProviders}
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
  renderNodeViewProviders?: (children: React.ReactNode) => React.ReactNode
  store: NodeViewStore | null
}> = ({ entry, registry, editorScope, renderNodeViewProviders, store }) => {
  const { Component } = entry
  const rootRef = React.useRef<MountedReactRoot | null>(null)
  const unmountRef = React.useRef<(() => void) | null>(null)
  const pendingCleanupRef = React.useRef<object | null>(null)

  const content = renderNodeViewProviders?.(
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
    </RegistryContext.Provider>,
  ) ?? (
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
    pendingCleanupRef.current = null

    if (rootRef.current === null) {
      const rootResource = runScopedResourceSync(acquireReactRoot(entry.dom))
      const root = rootResource.value
      rootRef.current = root

      let closed = false
      unmountRef.current = () => {
        if (closed) return
        closed = true
        rootResource.close()
        if (rootRef.current === root) rootRef.current = null
        if (unmountRef.current !== null) unmountRef.current = null
      }
    }

    const unmount = unmountRef.current
    if (unmount === null) return
    store?.setUnmount(entry.key, unmount)
    return () => {
      const cleanupToken = {}
      pendingCleanupRef.current = cleanupToken
      queueMicrotask(() => {
        if (pendingCleanupRef.current !== cleanupToken) return
        pendingCleanupRef.current = null
        store?.clearUnmount(entry.key, unmount)
        unmount()
      })
    }
  }, [entry.dom, entry.key, store])

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (root) {
      Effect.runSync(root.render(content))
    }
  })

  return null
}
