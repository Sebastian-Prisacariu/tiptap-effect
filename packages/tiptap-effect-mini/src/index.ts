export * as Editor from "./Editor"
export * as EditorAtom from "./EditorAtom"
export * as EditorError from "./EditorError"
export * as EditorReact from "./EditorReact"
export * as EditorRef from "./EditorRef"

export { createEditor } from "./createEditor"
export {
  defineMark,
  defineNode,
  defineSchema,
  documentAtom as typedDocumentAtom,
  EditorUnavailable,
  InvalidDocument,
  InvalidInsertion,
  InvalidMark,
  InvalidNode,
  type AnyEditorSchema,
  type DocumentOf,
  type EditorSchema,
  type MarkDefinition,
  type MarkJSON,
  type MarkOf,
  type NodeDefinition,
  type NodeJSON,
  type NodeOf,
  type TypedEditorError,
} from "./schema"

export type {
  Editor as EditorInstance,
  Event as MiniEditorEvent,
  Id as EditorId,
  Options as EditorOptions,
  RefreshKind as EditorRefreshKind,
  RunInput as RunEditorInput,
  RunSyncInput as RunEditorSyncInput,
  Snapshot as EditorSnapshot,
  StateOptions as UseEditorStateOptions,
} from "./Editor"

export { eventNames as editorEventNames } from "./Editor"
export { OptionsMissing as EditorOptionsMissingError } from "./EditorError"
export { useMergedRef } from "./EditorRef"

export {
  canRun as canRunAtom,
  editor as editorAtom,
  events as editorEventsAtom,
  html as editorHTMLAtom,
  instance as editorInstanceAtom,
  isActive as isActiveAtom,
  isEditable as isEditableAtom,
  isFocused as isFocusedAtom,
  isMounted as isMountedAtom,
  json as editorJSONAtom,
  mounted as mountedEditorAtom,
  mountElement as mountElementAtom,
  options as editorOptionsAtom,
  refresh as refreshEditorAtom,
  run as runEditorAtom,
  runSync as runEditorSyncAtom,
  setContent as setContentAtom,
  setEditable as setEditableAtom,
  setOptions as setEditorOptionsAtom,
  slice as editorSliceAtom,
  snapshot as editorSnapshotAtom,
  text as editorTextAtom,
} from "./EditorAtom"

export {
  Content as EditorContent,
  Provider as MiniTiptapProvider,
  useCanRun,
  useEditable,
  useEditor,
  useEvent as useEditorEvent,
  useHTML as useEditorHTML,
  useId as useEditorId,
  useIsActive,
  useIsEditable,
  useIsFocused,
  useJSON as useEditorJSON,
  useLifecycle as useEditorLifecycle,
  useRefresh as useRefreshEditor,
  useRun as useRunEditor,
  useRunEffect as useRunEditorEffect,
  useSetContent,
  useSetEditable,
  useSnapshot as useEditorSnapshot,
  useState as useEditorState,
  useSubscribe as useEditorSubscribe,
  useText as useEditorText,
} from "./EditorReact"
