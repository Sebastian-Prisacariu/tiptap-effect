import { Schema } from "effect"
import type { MarkDefinition } from "../node-definition.js"

export const BoldMark: MarkDefinition<"bold", Record<string, never>> = {
  name: "bold",
  attrsSchema: Schema.Struct({}),
  parseHTML: () => [
    { tag: "strong" },
    { tag: "b" },
    { style: "font-weight=bold" },
  ],
  renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
    ["strong", HTMLAttributes, 0],
}
