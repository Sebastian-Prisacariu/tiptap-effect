import { Schema } from "effect"
import { defineEditorCommand } from "../command"

/** Focus the editor. Reverse blurs. Both kinds are essentially side-effect-only. */
export const FocusCommand = defineEditorCommand({
  op: "tiptap-effect.focus",
  description: () => "Focus editor",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  apply: (chain, _input) => chain.focus(),
  applyReverse: (chain, _input, _captured) => chain.blur(),
  reverseSetup: () => ({}),
})

/** Blur the editor. Reverse focuses. */
export const BlurCommand = defineEditorCommand({
  op: "tiptap-effect.blur",
  description: () => "Blur editor",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  apply: (chain, _input) => chain.blur(),
  applyReverse: (chain, _input, _captured) => chain.focus(),
  reverseSetup: () => ({}),
})
