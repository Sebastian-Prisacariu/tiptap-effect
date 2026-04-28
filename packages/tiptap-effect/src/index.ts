// tiptap-effect — atom-driven Tiptap wrapper.
// Public API barrel.

export const PACKAGE_NAME = "tiptap-effect"

// Schema layer
export {
  defineEditorSchema,
  type EditorSchema,
  type NodeJSON,
  type MarkJSON,
} from "./schema/define"
export {
  tiptapAttrsFromSchema,
  type TiptapAttributeSpec,
} from "./schema/derive"
export type {
  NodeDefinition,
  MarkDefinition,
} from "./schema/node-definition"
export { SelectionInfo } from "./schema/selection"
export * as Nodes from "./schema/nodes/index"
export * as Marks from "./schema/marks/index"

// Editor
export {
  makeEditorAtom,
  EditorInitError,
  type EditorSpec,
  type EditorHandle,
} from "./editor"

// Runtime + services
export { editorRuntime, TiptapLayer } from "./runtime"

// Types
export { EditorId, type TransactionSnapshot } from "./types"

// Command system
export {
  defineCommand,
  defineEditorCommand,
  Reverse,
  NotReversibleError,
  CommandApplicationError,
  CommandValidationError,
  type Command,
  type EditorCommand,
  type EditorRunnableCommand,
  type RunnableCommand,
  type ReverseKind,
  type ConcurrencyPolicy,
  CurrentEditor,
  CommandExecutor,
  CommandExecutorLive,
  CommandBusyError,
  type NotReversibleAttempt,
  type CommandFailed,
  CommandHistory,
  type CommandRecord,
  reverseKind,
  Sequence,
  PartialFailure,
  SequenceFailure,
  sequenceRecordSchema,
  type SequenceRecord,
  type SequenceCommand,
  undoableAtom,
  redoableAtom,
  commandPendingAtom,
} from "./command"

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
} from "./editor"

// Dirty tracking atoms
export { dirtyAtom, lastSavedAtom } from "./dirty"

// Built-in commands
export * as Commands from "./command/commands/index"

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
  useHistoryPromise,
  useCommandPending,
  useCommandErrors,
  useRawEditor,
  type ScopedEditorContextValue,
} from "./react/index"
