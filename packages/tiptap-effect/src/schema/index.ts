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
} from "./define"
export {
  tiptapAttrsFromSchema,
  type TiptapAttributeSpec,
} from "./derive"
export type {
  NodeDefinition,
  MarkDefinition,
} from "./node-definition"
export {
  defineNodeDefinition,
  defineMarkDefinition,
} from "./node-definition"
export { SelectionInfo } from "./selection"
export * from "./nodes/index"
export * from "./marks/index"
export * as Nodes from "./nodes/index"
export * as Marks from "./marks/index"
