import { Schema } from "effect"
import type { NodeDefinition } from "../node-definition"

export const TextNode: NodeDefinition<"text", Record<string, never>> = {
  name: "text",
  attrsSchema: Schema.Struct({}),
  group: "inline",
}
