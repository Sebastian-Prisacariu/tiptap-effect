import {
  Editor as NativeEditor,
  type EditorEvents as NativeEditorEvents,
  type EditorOptions as NativeEditorOptions,
} from "@tiptap/core"
import type { Effect } from "effect"
import * as internal from "./internal/editor"

/**
 * @category models
 */
export type Editor = NativeEditor

/**
 * @category models
 */
export type Id = string

/**
 * @category events
 */
export type Event = internal.Event

/**
 * @category options
 */
export type Options = Omit<Partial<NativeEditorOptions>, "element"> & {
  readonly immediatelyRender?: boolean
}

/**
 * @category models
 */
export type Snapshot = {
  readonly editor: Editor
  readonly version: number
  readonly documentVersion: number
  readonly selectionVersion: number
  readonly focusVersion: number
}

/**
 * @category models
 */
export type StateOptions<T> = {
  readonly selector: (snapshot: Snapshot) => T
  readonly equalityFn?: (left: T, right: T) => boolean
}

/**
 * @category models
 */
export type RefreshKind = "document" | "selection" | "focus" | "transaction"

/**
 * @category mutations
 */
export type RunInput = {
  readonly id: Id
  readonly run: (editor: Editor) => Effect.Effect<unknown, unknown, never>
  readonly refresh?: ReadonlyArray<RefreshKind>
}

/**
 * @category mutations
 */
export type RunSyncInput = {
  readonly id: Id
  readonly run: (editor: Editor) => unknown
  readonly refresh?: ReadonlyArray<RefreshKind>
}

/**
 * @category events
 */
export type EventPayload<Event extends internal.Event> = NativeEditorEvents[Event]

/**
 * @category events
 */
export const eventNames = internal.eventNames

/**
 * @category events
 */
export const defaultRefreshEvents = internal.defaultRefreshEvents

