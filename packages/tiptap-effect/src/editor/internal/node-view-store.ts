import type * as React from "react"
import { Either } from "effect"

const storesByEditorView = new WeakMap<object, NodeViewStore>()
const constructionStoreStack: Array<NodeViewStore> = []
const pendingEntriesByEditorView = new WeakMap<object, Array<NodeViewEntry>>()

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

export interface NodeViewEntry {
  readonly key: string
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement | null
  readonly Component: React.FC<Record<string, unknown>>
  readonly componentProps: Record<string, unknown>
  readonly props: NodeViewProps | null
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

const propsEqual = (a: NodeViewProps, b: NodeViewProps): boolean =>
  shallowEqual(a.nodeAttrs, b.nodeAttrs)
  && a.nodeType === b.nodeType
  && a.nodeSize === b.nodeSize
  && a.getPos === b.getPos
  && a.selected === b.selected
  && a.unsafeNode === b.unsafeNode

/**
 * Per-editor registry of active NodeViews. The Tiptap node-view callback
 * adds/updates/removes entries as PM creates and tears down NodeViews; the
 * React view subscribes via `useSyncExternalStore` and renders one child root
 * per entry.
 */
export class NodeViewStore {
  private entries = new Map<string, NodeViewEntry>()
  private unmounts = new Map<string, () => void>()
  private listeners = new Set<() => void>()
  private nextId = 0

  nextKey(prefix = "nv"): string {
    return `${prefix}-${++this.nextId}`
  }

  add(entry: NodeViewEntry): void {
    this.entries.set(entry.key, entry)
    this.notify()
  }

  update(key: string, props: NodeViewProps): void {
    const existing = this.entries.get(key)
    if (!existing || !existing.props) return
    if (propsEqual(existing.props, props)) return
    this.entries.set(key, { ...existing, props })
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

  private snapshot: ReadonlyArray<NodeViewEntry> = []
  private snapshotDirty = true

  getSnapshot = (): ReadonlyArray<NodeViewEntry> => {
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

export const registerNodeViewStoreForEditorView = (
  editorView: object,
  store: NodeViewStore,
): (() => void) => {
  storesByEditorView.set(editorView, store)
  const pending = pendingEntriesByEditorView.get(editorView)
  if (pending) {
    pendingEntriesByEditorView.delete(editorView)
    pending.forEach((entry) => store.add(entry))
  }
  return () => {
    if (storesByEditorView.get(editorView) === store) {
      storesByEditorView.delete(editorView)
    }
  }
}

export const getNodeViewStoreForEditorView = (
  editorView: object,
): NodeViewStore | undefined =>
  storesByEditorView.get(editorView)
  ?? constructionStoreStack[constructionStoreStack.length - 1]

export const withNodeViewStoreForEditorConstruction = <A>(
  store: NodeViewStore,
  f: () => A,
): A => {
  constructionStoreStack.push(store)
  const result = Either.try(f)
  constructionStoreStack.pop()
  return Either.getOrThrow(result)
}

export const addPendingNodeViewEntryForEditorView = (
  editorView: object,
  entry: NodeViewEntry,
): void => {
  const store = storesByEditorView.get(editorView)
  if (store) {
    store.add(entry)
    return
  }
  const pending = pendingEntriesByEditorView.get(editorView)
  if (pending) {
    pending.push(entry)
  } else {
    pendingEntriesByEditorView.set(editorView, [entry])
  }
}

export const removePendingNodeViewEntryForEditorView = (
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
