import { Schema } from "effect"
import { defineEditorCommand } from "../command.js"

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
    apply: (chain, _input) => chain.focus().toggleMark(markName),
    reverseSetup: (state, _input) => {
      const s = state as {
        schema: { marks: Record<string, unknown> }
        selection: { from: number; to: number; empty: boolean; $from: any }
        doc: { rangeHasMark: (a: number, b: number, m: any) => boolean }
        storedMarks?: ReadonlyArray<{ type: { name: string } }> | null
      }
      const markType = s.schema.marks[markName]
      const wasActive = !markType
        ? false
        : s.selection.empty
          ? (s.storedMarks ?? s.selection.$from?.marks?.() ?? []).some(
              (m: { type: { name: string } }) => m.type.name === markName,
            )
          : s.doc.rangeHasMark(s.selection.from, s.selection.to, markType)
      return {
        wasActive,
        from: s.selection.from,
        to: s.selection.to,
      }
    },
    applyReverse: (chain, _input, { from, to, wasActive }) =>
      // Restore selection first, then explicitly set the mark to its prior
      // state. `setMark` / `unsetMark` is more robust than relying on
      // `toggleMark` to flip cleanly.
      wasActive
        ? chain.focus().setTextSelection({ from, to }).setMark(markName)
        : chain.focus().setTextSelection({ from, to }).unsetMark(markName),
  })
