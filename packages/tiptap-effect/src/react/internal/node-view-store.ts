import type * as React from "react"

export interface NodeViewProps {
  readonly nodeAttrs: Record<string, unknown>
  readonly nodeType: string
  readonly getPos: () => number | undefined
  readonly selected: boolean
}

export interface NodeViewEntry {
  readonly key: string
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement | null
  readonly Component: React.FC
  readonly props: NodeViewProps
}

/**
 * Per-editor registry of active NodeViews. The Tiptap node-view callback
 * adds/updates/removes entries as PM creates and tears down NodeViews; the
 * `<TiptapView />` component subscribes via `useSyncExternalStore` and
 * renders one React Portal per entry.
 */
export class NodeViewStore {
  private entries = new Map<string, NodeViewEntry>()
  private listeners = new Set<() => void>()
  private nextId = 0

  nextKey(): string {
    return `nv-${++this.nextId}`
  }

  add(entry: NodeViewEntry): void {
    this.entries.set(entry.key, entry)
    this.notify()
  }

  update(key: string, props: NodeViewProps): void {
    const existing = this.entries.get(key)
    if (!existing) return
    this.entries.set(key, { ...existing, props })
    this.notify()
  }

  remove(key: string): void {
    this.entries.delete(key)
    this.notify()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  // Snapshot is reference-stable until a mutation; useSyncExternalStore
  // requires this for correctness.
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
    this.listeners.forEach((l) => l())
  }
}
