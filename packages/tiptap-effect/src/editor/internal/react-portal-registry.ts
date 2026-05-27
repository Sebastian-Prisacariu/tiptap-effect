import type * as React from "react"

const registriesByEditorView = new WeakMap<object, ReactPortalRegistry>()
const constructionRegistryStack: Array<ReactPortalRegistry> = []
const pendingEntriesByEditorView = new WeakMap<object, Array<ReactPortalEntry>>()
let pendingId = 0

export interface NodeViewProps {
  readonly nodeAttrs: Record<string, unknown>
  readonly nodeType: string
  readonly nodeSize: number
  readonly getPos: () => number | undefined
  readonly selected: boolean
  /**
   * Raw PM Node — escape hatch for node-typed operations not covered by
   * `attrs`. Don't mutate; use a Command for any change.
   */
  readonly unsafeNode: unknown
}

export type ReactPortalKind = "node-view" | "decoration"

export interface ReactPortalEntry {
  readonly key: string
  readonly kind: ReactPortalKind
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement | null
  readonly Component: React.FC<Record<string, unknown>>
  readonly componentProps: Record<string, unknown>
  readonly nodeViewProps: NodeViewProps | null
}

const shallowEqual = (
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean => {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Object.is(a[key], b[key]))
}

const nodeViewPropsEqual = (a: NodeViewProps, b: NodeViewProps): boolean =>
  shallowEqual(a.nodeAttrs, b.nodeAttrs)
  && a.nodeType === b.nodeType
  && a.nodeSize === b.nodeSize
  && a.getPos === b.getPos
  && a.selected === b.selected
  && a.unsafeNode === b.unsafeNode

/**
 * Per-editor registry of React portals hosted inside ProseMirror-owned DOM.
 * NodeViews and React decorations both register entries here; TiptapView is
 * the only React subscriber.
 */
export class ReactPortalRegistry {
  private entries = new Map<string, ReactPortalEntry>()
  private unmounts = new Map<string, () => void>()
  private listeners = new Set<() => void>()
  private nextId = 0
  private snapshot: ReadonlyArray<ReactPortalEntry> = []
  private snapshotDirty = true

  nextKey(prefix = "portal"): string {
    return `${prefix}-${++this.nextId}`
  }

  add(entry: ReactPortalEntry): void {
    this.entries.set(entry.key, entry)
    this.notify()
  }

  updateNodeView(key: string, props: NodeViewProps): void {
    const existing = this.entries.get(key)
    if (!existing || !existing.nodeViewProps) return
    if (nodeViewPropsEqual(existing.nodeViewProps, props)) return
    this.entries.set(key, { ...existing, nodeViewProps: props })
    this.notify()
  }

  remove(key: string): void {
    this.unmount(key, { defer: true })
    this.entries.delete(key)
    this.notify()
  }

  setUnmount(key: string, unmount: () => void): void {
    if (!this.entries.has(key)) {
      unmount()
      return
    }
    this.unmounts.set(key, unmount)
  }

  clearUnmount(key: string, unmount: () => void): void {
    if (this.unmounts.get(key) === unmount) {
      this.unmounts.delete(key)
    }
  }

  dispose(): void {
    Array.from(this.unmounts.keys()).forEach((key) =>
      this.unmount(key, { defer: false }),
    )
    this.entries.clear()
    this.snapshotDirty = true
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = (): ReadonlyArray<ReactPortalEntry> => {
    if (this.snapshotDirty) {
      this.snapshot = Array.from(this.entries.values())
      this.snapshotDirty = false
    }
    return this.snapshot
  }

  private notify(): void {
    this.snapshotDirty = true
    this.listeners.forEach((listener) => listener())
  }

  private unmount(
    key: string,
    options: { readonly defer: boolean },
  ): void {
    const unmount = this.unmounts.get(key)
    if (!unmount) return
    this.unmounts.delete(key)
    if (options.defer) queueMicrotask(unmount)
    else unmount()
  }
}

export const registerReactPortalRegistryForEditorView = (
  editorView: object,
  registry: ReactPortalRegistry,
): (() => void) => {
  registriesByEditorView.set(editorView, registry)
  const pending = pendingEntriesByEditorView.get(editorView)
  if (pending) {
    pendingEntriesByEditorView.delete(editorView)
    pending.forEach((entry) => registry.add(entry))
  }
  return () => {
    if (registriesByEditorView.get(editorView) === registry) {
      registriesByEditorView.delete(editorView)
    }
  }
}

const getReactPortalRegistryForEditorView = (
  editorView: object,
): ReactPortalRegistry | undefined =>
  registriesByEditorView.get(editorView)
  ?? constructionRegistryStack[constructionRegistryStack.length - 1]

export const withReactPortalRegistryForEditorConstruction = <A>(
  registry: ReactPortalRegistry,
  f: () => A,
): A => {
  constructionRegistryStack.push(registry)
  try {
    return f()
  } finally {
    constructionRegistryStack.pop()
  }
}

const addPendingReactPortalEntryForEditorView = (
  editorView: object,
  entry: ReactPortalEntry,
): void => {
  const registry = registriesByEditorView.get(editorView)
  if (registry) {
    registry.add(entry)
    return
  }
  const pending = pendingEntriesByEditorView.get(editorView)
  if (pending) {
    pending.push(entry)
  } else {
    pendingEntriesByEditorView.set(editorView, [entry])
  }
}

const removePendingReactPortalEntryForEditorView = (
  editorView: object,
  key: string,
): void => {
  const pending = pendingEntriesByEditorView.get(editorView)
  if (!pending) return
  const index = pending.findIndex((entry) => entry.key === key)
  if (index === -1) return
  pending.splice(index, 1)
  if (pending.length === 0) pendingEntriesByEditorView.delete(editorView)
}

export const registerReactPortalEntryForEditorView = (
  editorView: object,
  prefix: string,
  makeEntry: (key: string) => ReactPortalEntry,
): {
  readonly key: string
  readonly dispose: () => void
} => {
  const registry = getReactPortalRegistryForEditorView(editorView)
  const key = registry?.nextKey(prefix) ?? `${prefix}-pending-${++pendingId}`
  const entry = makeEntry(key)
  if (registry) {
    registry.add(entry)
  } else {
    addPendingReactPortalEntryForEditorView(editorView, entry)
  }

  let disposed = false
  return {
    key,
    dispose: () => {
      if (disposed) return
      disposed = true
      const attachedRegistry =
        registriesByEditorView.get(editorView) ?? registry
      if (attachedRegistry) {
        attachedRegistry.remove(key)
      } else {
        removePendingReactPortalEntryForEditorView(editorView, key)
      }
    },
  }
}
