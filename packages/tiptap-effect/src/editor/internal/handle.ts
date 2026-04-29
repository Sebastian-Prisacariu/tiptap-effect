import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect } from "effect"
import { EditorContext } from "./context"
import { NodeViewStore } from "./node-view-store"

interface EditorHandle {
  readonly mount: (el: HTMLElement | null) => void
  readonly _internal: {
    readonly editor: TiptapEditor
    readonly nodeViewStore: NodeViewStore
  }
}

const makeEditorHandle = (nodeViewStore: NodeViewStore) =>
  Effect.map(EditorContext, ({ editor }): EditorHandle => ({
    mount: (el: HTMLElement | null) => {
      if (el) editor.mount(el)
      else editor.unmount()
    },
    _internal: { editor, nodeViewStore },
  }))

export { makeEditorHandle, type EditorHandle }
