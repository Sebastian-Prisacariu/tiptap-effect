import { Schema } from "effect"
import type { MarkDefinition } from "../node-definition"

export const ItalicMark: MarkDefinition<"italic", Record<string, never>> = {
  name: "italic",
  attrsSchema: Schema.Struct({}),
  parseHTML: () => [
    { tag: "em" },
    { tag: "i" },
    { style: "font-style=italic" },
  ],
  renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
    ["em", HTMLAttributes, 0],
}
