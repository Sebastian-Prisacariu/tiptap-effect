export {
  defineEditorSchema,
  type EditorSchema,
  type NodeJSON,
  type MarkJSON,
} from "./define.js"
export {
  tiptapAttrsFromSchema,
  type TiptapAttributeSpec,
} from "./derive.js"
export type {
  NodeDefinition,
  MarkDefinition,
} from "./node-definition.js"
export * as Nodes from "./nodes/index.js"
export * as Marks from "./marks/index.js"
