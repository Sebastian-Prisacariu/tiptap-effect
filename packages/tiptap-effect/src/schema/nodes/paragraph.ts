import { Schema } from "effect"
import type { NodeDefinition } from "../node-definition"

export const ParagraphNode: NodeDefinition<"paragraph", Record<string, never>> = {
  name: "paragraph",
  attrsSchema: Schema.Struct({}),
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
    ["p", HTMLAttributes, 0],
}
