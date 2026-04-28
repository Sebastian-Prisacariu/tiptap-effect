import type { Extensions } from "@tiptap/core"

const HISTORY_NAMES = new Set(["history", "undoRedo"])

/**
 * Filter out ProseMirror's history extension (and Tiptap's `UndoRedo` alias).
 * `tiptap-effect` ships its own Effect-native history; PM's plugin would create
 * a parallel undo stack and confuse Cmd-Z semantics.
 *
 * Throws if `History` is detected when `strict: true` so consumers don't
 * silently include it via a starter-kit composition.
 */
export const withoutPmHistory = (
  extensions: Extensions,
  options: { strict?: boolean } = {},
): Extensions => {
  const filtered = extensions.filter((e) => !HISTORY_NAMES.has((e as { name: string }).name))
  if (options.strict && filtered.length !== extensions.length) {
    throw new Error(
      "tiptap-effect: PM `History` (or `UndoRedo`) extension is not allowed. "
      + "Use the package's Effect-native command history instead.",
    )
  }
  return filtered
}
