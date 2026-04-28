import { Schema } from "effect"
import type { NodeDefinition } from "../node-definition.js"

export const DocNode: NodeDefinition<"doc", Record<string, never>> = {
  name: "doc",
  attrsSchema: Schema.Struct({}),
  content: "block+",
  parseHTML: () => [{ tag: "div[data-doc]" }],
  renderHTML: () => ["div", { "data-doc": "" }, 0],
}
