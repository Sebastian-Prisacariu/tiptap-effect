import { Schema } from "effect"
import { defineEditorCommand } from "../command"

/**
 * Toggle a mark by name. Captures the previous active state so undo restores
 * it deterministically (re-running toggle if the state diverged).
 *
 * Usage: `useDispatch()(ToggleMarkCommand("bold"), undefined)`.
 */
export const ToggleMarkCommand = (markName: string) =>
  defineEditorCommand({
    op: `tiptap-effect.mark.${markName}.toggle` as const,
    description: () => `Toggle ${markName}`,
    inputSchema: Schema.Void,
    outputSchema: Schema.Struct({
      wasActive: Schema.Boolean,
      from: Schema.Number,
      to: Schema.Number,
    }),
    capturesSelection: true,
    apply: (chain, _input) => chain.toggleMark(markName),
    reverseSetup: (state, _input) => {
      const markType = state.schema.marks[markName]
      const wasActive = !markType
        ? false
        : state.selection.empty
          ? (state.storedMarks ?? state.selection.$from?.marks?.() ?? []).some(
              (m) => m.type.name === markName,
            )
          : state.doc.rangeHasMark(state.selection.from, state.selection.to, markType)
      return {
        wasActive,
        from: state.selection.from,
        to: state.selection.to,
      }
    },
    applyReverse: (chain, _input, { from, to, wasActive }) =>
      // Restore selection first, then explicitly set the mark to its prior
      // state. `setMark` / `unsetMark` is more robust than relying on
      // `toggleMark` to flip cleanly.
      wasActive
        ? chain.setTextSelection({ from, to }).setMark(markName)
        : chain.setTextSelection({ from, to }).unsetMark(markName),
  })
