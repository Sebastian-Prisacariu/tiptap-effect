import { Schema } from "effect"
import type { NodeDefinition } from "../node-definition"

const HeadingAttrs = Schema.Struct({
  level: Schema.Literal(1, 2, 3, 4, 5, 6).pipe(
    Schema.optionalWith({ default: () => 1 as const }),
  ),
})

export type HeadingAttrs = typeof HeadingAttrs.Type

type HeadingRenderNode = {
  readonly attrs?: { readonly level?: number }
}

export const HeadingNode: NodeDefinition<"heading", HeadingAttrs> = {
  name: "heading",
  attrsSchema: HeadingAttrs as unknown as NodeDefinition<"heading", HeadingAttrs>["attrsSchema"],
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML: () =>
    [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  renderHTML: ({
    node,
    HTMLAttributes,
  }: {
    node: unknown
    HTMLAttributes: Record<string, unknown>
  }) => {
    const level = (node as HeadingRenderNode).attrs?.level ?? 1
    return [`h${level}`, HTMLAttributes, 0]
  },
}
