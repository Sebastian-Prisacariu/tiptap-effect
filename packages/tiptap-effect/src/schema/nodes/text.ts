import { Schema } from "effect"
import type { NodeDefinition } from "../node-definition.js"

export const TextNode: NodeDefinition<"text", Record<string, never>> = {
  name: "text",
  attrsSchema: Schema.Struct({}),
  group: "inline",
}
