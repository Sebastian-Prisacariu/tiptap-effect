import type { JSONContent } from "@tiptap/core"
import { Schema } from "effect"
import { defineEditorCommand } from "../command"

/**
 * Replace the document with an empty paragraph. Captures the prior content
 * so undo restores it exactly.
 */
export const ClearContentCommand = defineEditorCommand({
  op: "tiptap-effect.clear-content",
  description: () => "Clear document",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({ previousContent: Schema.Unknown }),
  apply: (chain, _input) => chain.clearContent(true),
  reverseSetup: (state, _input) => ({ previousContent: state.doc.toJSON() }),
  applyReverse: (chain, _input, { previousContent }) =>
    chain.setContent(previousContent as JSONContent),
})
