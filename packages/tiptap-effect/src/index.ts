// tiptap-effect — atom-driven Tiptap wrapper.
// Public API barrel.

export const PACKAGE_NAME = "tiptap-effect"

export {
  createEditor,
  type CreatedEditor,
} from "./create-editor"

// Schema layer
export {
  defineEditorSchema,
  type EditorSchema,
  type AnyEditorSchema,
  type DocumentOf,
  type NodeOf,
  type MarkOf,
  type InsertableNodeOf,
  type InsertableContentOf,
  type NodeNameOf,
  type AttrsOfNode,
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
export {
  defineNodeDefinition,
  defineMarkDefinition,
} from "./schema/node-definition"
export { SelectionInfo } from "./schema/selection"
export * as Nodes from "./schema/nodes/index"
export * as Marks from "./schema/marks/index"

// Editor
export {
  makeEditorAtom,
  EditorInitError,
  SchemaCollisionError,
  type EditorSpec,
  type EditorHandle,
  type SchemaMismatchPolicy,
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
  TransactionalRollbackError,
  CommandExecutor,
  CommandExecutorLive,
  CommandErrorHandler,
  CommandErrorHandlerLive,
  CommandBusyError,
  ReplayDivergenceError,
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
  defineEditorCommands,
  ContentPositionError,
  EditorCommandError,
  EditorCommandCollisionError,
  type EditorCommands,
  type EditorCommandFactoryContext,
  type EditorCommandOptions,
  type DocumentCommandAuthoring,
  type PreviousContentOutput,
  type SelectorPatchOutput,
  type TypedNodeSelector,
  type TypedNodeSelectorWithType,
  type UpdateAttrsAtOutput,
  type UpdateNodeAttrsAtInput,
  type UpdateNodeAttrsBySelectorInput,
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
  selectedNodeAtom,
  canExecuteAtom,
  plainTextAtom,
  focusAtom,
  transactionBusAtom,
  docAtom,
  htmlAtom,
  type SelectedNodeInfo,
} from "./editor"

// Static rendering — re-exported from @tiptap/core for SSR / non-editable views
export { generateHTML } from "@tiptap/core"

// Dirty tracking atoms
export { dirtyAtom, lastSavedAtom } from "./dirty"

export * as DocumentSelectors from "./document/index"

// React layer
export {
  EditorScope,
  TiptapView,
  reactNodeView,
  reactDecoration,
  useEditorScope,
  useEditorSlice,
  useEditorSubscribe,
  useDispatch,
  useHistory,
  useCommandPending,
  useCommandErrors,
  useNodeViewActions,
  useRawEditor,
  useNodeViewProps,
  type DispatchEffect,
  type DispatchMode,
  type DispatchPromise,
  type DispatchResult,
  type HistoryEffect,
  type HistoryMode,
  type HistoryPromise,
  type HistoryResult,
  type ReactDecorationSpec,
  type ScopedEditorContextValue,
  type UseDispatchOptions,
  type UseHistoryOptions,
} from "./react/index"
