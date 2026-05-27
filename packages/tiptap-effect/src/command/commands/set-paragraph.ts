import { Schema } from "effect"
import { defineEditorCommand } from "../command"

type ParagraphChain<Chain> = Chain & {
  readonly setParagraph: () => Chain
  readonly toggleHeading?: (attrs: { readonly level: 1 | 2 | 3 | 4 | 5 | 6 }) => Chain
}

export const SetParagraphCommand = defineEditorCommand({
  op: "tiptap-effect.set-paragraph",
  description: () => "Set paragraph",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({
    previousType: Schema.String,
    previousLevel: Schema.Union(Schema.Number, Schema.Null),
    from: Schema.Number,
    to: Schema.Number,
  }),
  capturesSelection: true,
  apply: (chain) => (chain.focus() as ParagraphChain<typeof chain>).setParagraph(),
  reverseSetup: (state) => {
    const node = state.selection.$from.parent
    return {
      previousType: node?.type?.name ?? "paragraph",
      previousLevel: node?.attrs?.level ?? null,
      from: state.selection.from,
      to: state.selection.to,
    }
  },
  applyReverse: (chain, _input, { previousType, previousLevel, from, to }) => {
    const restored = chain.focus().setTextSelection({ from, to }) as ParagraphChain<typeof chain>
    if (previousType === "heading" && previousLevel !== null && restored.toggleHeading) {
      return restored.toggleHeading({ level: previousLevel as 1 | 2 | 3 | 4 | 5 | 6 })
    }
    return restored.setParagraph()
  },
})
