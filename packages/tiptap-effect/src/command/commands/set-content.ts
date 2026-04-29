import type { JSONContent } from "@tiptap/core"
import { Schema } from "effect"
import { defineEditorCommand } from "../command"

/**
 * Replace the entire document with new content.
 *
 * Captures `previousContent` (full prior JSON doc) in the result, so undo
 * restores the doc exactly as it was. Use sparingly — replacing a large doc
 * is heavy. The Schema validation happens in the consumer's wiring (e.g.
 * persistence layer); the Command itself accepts `Unknown` so consumers can
 * decode through their app schema before dispatch.
 */
export const SetContentCommand = defineEditorCommand({
  op: "tiptap-effect.set-content",
  description: () => "Replace document content",
  inputSchema: Schema.Struct({ content: Schema.Unknown }),
  outputSchema: Schema.Struct({ previousContent: Schema.Unknown }),
  apply: (chain, { content }) => chain.setContent(content as JSONContent),
  reverseSetup: (state, _input) => ({ previousContent: state.doc.toJSON() }),
  applyReverse: (chain, _input, { previousContent }) =>
    chain.setContent(previousContent as JSONContent),
})
