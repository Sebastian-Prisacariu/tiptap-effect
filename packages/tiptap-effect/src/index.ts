// tiptap-effect — atom-driven Tiptap wrapper.
// Public API barrel.

export const PACKAGE_NAME = "tiptap-effect"

// Schema layer
export {
  defineEditorSchema,
  type EditorSchema,
  type NodeJSON,
  type MarkJSON,
} from "./schema/define.js"
export {
  tiptapAttrsFromSchema,
  type TiptapAttributeSpec,
} from "./schema/derive.js"
export type {
  NodeDefinition,
  MarkDefinition,
} from "./schema/node-definition.js"
export { SelectionInfo } from "./schema/selection.js"
export * as Nodes from "./schema/nodes/index.js"
export * as Marks from "./schema/marks/index.js"

// Editor
export {
  makeEditorAtom,
  EditorInitError,
  type EditorSpec,
  type EditorHandle,
} from "./editor.js"

// Runtime + services
export { editorRuntime, TiptapLayer } from "./runtime.js"
export { TransactionBus } from "./transaction-bus.js"

// Types
export { EditorId, type TransactionSnapshot } from "./types.js"

// Command system
export {
  defineCommand,
  defineEditorCommand,
  Reverse,
  NotReversibleError,
  type Command,
  type EditorCommand,
  type ReverseKind,
  type ConcurrencyPolicy,
} from "./command.js"
export { CurrentEditor } from "./current-editor.js"
export {
  CommandExecutor,
  CommandExecutorLive,
  CommandBusyError,
  type NotReversibleAttempt,
  type CommandFailed,
} from "./command-executor.js"
export {
  CommandHistory,
  type CommandRecord,
  reverseKind,
} from "./command-history.js"
export {
  Sequence,
  PartialFailure,
  SequenceFailure,
  sequenceRecordSchema,
  type SequenceRecord,
  type SequenceCommand,
} from "./command-sequence.js"

// Slice atoms
export {
  selectionAtom,
  selectedTextAtom,
  hasSelectionAtom,
  isCollapsedAtom,
  isActiveAtom,
  plainTextAtom,
  focusAtom,
  transactionBusAtom,
} from "./slices.js"
export { undoableAtom, redoableAtom } from "./history-atoms.js"
export { dirtyAtom, lastSavedAtom } from "./dirty.js"
export { commandPendingAtom } from "./pending-atoms.js"

// Dirty tracking service (consumed by MarkSavedCommand and dirtyAtom)
export { DirtyTracker, DirtyTrackerLive } from "./dirty-tracker.js"

// Built-in commands
export * as Commands from "./commands/index.js"

// React layer
export {
  EditorScope,
  TiptapView,
  useEditorScope,
  useEditorSlice,
  useEditorSubscribe,
  useDispatch,
  useDispatchEffect,
  useDispatchPromise,
  useHistory,
  useCommandPending,
  useCommandErrors,
  useRawEditor,
  type ScopedEditorContextValue,
} from "./react/index.js"
