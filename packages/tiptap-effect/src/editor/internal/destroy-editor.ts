import type { Editor as TiptapEditor } from "@tiptap/core"
import { unregisterEditor } from "../../internal/editor-ids"

const destroyedEditors = new WeakSet<TiptapEditor>()

export const destroyEditorOnce = (editor: TiptapEditor): void => {
  if (destroyedEditors.has(editor)) return
  destroyedEditors.add(editor)
  editor.destroy()
  unregisterEditor(editor)
}
