import { Schema } from "effect"
import { defineEditorCommand } from "../command"

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

type HeadingChain<Chain> = Chain & {
  readonly toggleHeading: (attrs: { readonly level: HeadingLevel }) => Chain
  readonly setHeading: (attrs: { readonly level: HeadingLevel }) => Chain
  readonly setParagraph: () => Chain
}

/**
 * Toggle the block at the current selection between a heading at the given
 * level and a paragraph. Tiptap's `toggleHeading` already implements this
 * semantics; we wrap it as a Command for audit + undo.
 *
 * `toggleHeading`/`setHeading`/`setParagraph` are contributed by
 * `@tiptap/extension-heading`; consumers must install the extension and add
 * it to the editor's extension list themselves.
 */
export const SetHeadingCommand = defineEditorCommand({
  op: "tiptap-effect.set-heading",
  description: ({ level }) => `Toggle heading H${level}`,
  inputSchema: Schema.Struct({
    level: Schema.Literal(1, 2, 3, 4, 5, 6),
  }),
  outputSchema: Schema.Struct({
    previousType: Schema.String,
    previousLevel: Schema.Union(Schema.Number, Schema.Null),
    from: Schema.Number,
    to: Schema.Number,
  }),
  capturesSelection: true,
  apply: (chain, { level }) =>
    (chain.focus() as HeadingChain<typeof chain>).toggleHeading({ level }),
  reverseSetup: (state, _input) => {
    const node = state.selection.$from.parent
    return {
      previousType: node?.type?.name ?? "paragraph",
      previousLevel: node?.attrs?.level ?? null,
      from: state.selection.from,
      to: state.selection.to,
    }
  },
  applyReverse: (chain, _input, { previousType, previousLevel, from, to }) => {
    const restored = chain.focus().setTextSelection({ from, to }) as HeadingChain<typeof chain>
    if (previousType === "heading" && previousLevel !== null) {
      return restored.setHeading({ level: previousLevel as HeadingLevel })
    }
    return restored.setParagraph()
  },
})
