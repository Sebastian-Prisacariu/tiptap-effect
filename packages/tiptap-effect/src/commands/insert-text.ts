import { Schema } from "effect"
import { defineEditorCommand } from "../command.js"

/**
 * Insert text at the current selection. Coalesces with adjacent
 * `InsertTextCommand` calls within ~500 ms when both have the same coalesceKey
 * (single-char inserts merge together; block pastes don't merge into chars).
 */
export const InsertTextCommand = defineEditorCommand({
  op: "tiptap-effect.insert.text",
  description: ({ text }) => `Insert "${text}"`,
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ from: Schema.Number, length: Schema.Number }),
  apply: (chain, { text }) => chain.insertContent(text),
  reverseSetup: (state, { text }) => {
    const s = state as { selection: { from: number } }
    return { from: s.selection.from, length: text.length }
  },
  applyReverse: (chain, _input, { from, length }) =>
    chain.deleteRange({ from, to: from + length }),
  capturesSelection: true,
  coalesceKey: ({ text }) => `insert-text:${text.length === 1 ? "char" : "block"}`,
  // Merge two adjacent InsertText records ONLY when the second insert lands
  // immediately after the first (i.e. the user is typing forward). Returning
  // `null` opts non-adjacent pairs out of merging — they remain separate
  // history entries, which is required for `applyReverse` (a single
  // `deleteRange`) to be correct.
  coalesce: (prev, next) => {
    if (next.output.from !== prev.output.from + prev.output.length) return null
    return {
      input: { text: prev.input.text + next.input.text },
      output: { from: prev.output.from, length: prev.output.length + next.output.length },
    }
  },
})
