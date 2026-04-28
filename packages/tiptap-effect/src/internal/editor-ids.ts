import type { Editor as TiptapEditor } from "@tiptap/core"
import type { EditorId } from "../types"

const editorIds = new WeakMap<TiptapEditor, EditorId>()

export const registerEditorId = (editor: TiptapEditor, id: EditorId): void => {
  editorIds.set(editor, id)
}

export const getEditorId = (editor: TiptapEditor): EditorId => {
  const id = editorIds.get(editor)
  if (!id) {
    throw new Error("tiptap-effect: editor is not registered with an EditorId")
  }
  return id
}
