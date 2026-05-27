export {
  EditorScope,
  useEditorScope,
  type ScopedEditorContextValue,
} from "./EditorScope"
export { TiptapView } from "./TiptapView"
export { reactNodeView } from "./node-view"
export {
  reactDecoration,
  type ReactDecorationSpec,
} from "./decoration"
export {
  useDispatch,
  useEditorState,
  useEditorSlice,
  useEditorSubscribe,
  useHistory,
  useHistoryPromise,
  useCommandPending,
  useCommandErrors,
  useNodeViewActions,
  useRawEditor,
  type DispatchEffect,
  type DispatchMode,
  type DispatchPromise,
  type DispatchResult,
  type EditorStateSnapshot,
  type UseEditorStateOptions,
  type UseDispatchOptions,
} from "./hooks"
export {
  NodeViewContext,
  NodeViewWrapper,
  useNodeViewProps,
} from "./NodeViewContext"
export {
  ReactRenderer,
  type ReactRendererOptions,
} from "./ReactRenderer"
export { isTextSelection } from "@tiptap/core"
export type {
  Editor,
  JSONContent,
} from "@tiptap/core"
export type { NodeViewProps } from "../editor/internal/node-view-store"
