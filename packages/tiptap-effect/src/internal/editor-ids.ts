import type { Editor as TiptapEditor } from "@tiptap/core"
import type { EditorId } from "../types"

const editorIds = new WeakMap<TiptapEditor, EditorId>()
const editorsById = new Map<EditorId, WeakRef<TiptapEditor>>()

export const registerEditorId = (editor: TiptapEditor, id: EditorId): void => {
  editorIds.set(editor, id)
  editorsById.set(id, new WeakRef(editor))
}

export const unregisterEditor = (editor: TiptapEditor): void => {
  const id = editorIds.get(editor)
  if (id !== undefined) {
    const ref = editorsById.get(id)
    if (ref && ref.deref() === editor) {
      editorsById.delete(id)
    }
  }
  editorIds.delete(editor)
}

export const getEditorId = (editor: TiptapEditor): EditorId => {
  const id = editorIds.get(editor)
  if (!id) {
    throw new Error("tiptap-effect: editor is not registered with an EditorId")
  }
  return id
}

export const getEditorById = (id: EditorId): TiptapEditor | null => {
  const ref = editorsById.get(id)
  if (!ref) return null
  const ed = ref.deref()
  if (!ed) {
    editorsById.delete(id)
    return null
  }
  return ed
}
