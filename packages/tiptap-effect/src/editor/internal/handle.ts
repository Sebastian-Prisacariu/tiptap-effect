import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect } from "effect"
import { EditorContext } from "./context"
import {
  NodeViewStore,
  registerNodeViewStoreForEditorView,
  withNodeViewStoreForEditorConstruction,
} from "./node-view-store"

interface EditorHandle {
  readonly mount: (el: HTMLElement | null) => void
  readonly _internal: {
    readonly editor: TiptapEditor
    readonly nodeViewStore: NodeViewStore
  }
}

const makeEditorHandle = (nodeViewStore: NodeViewStore) =>
  Effect.map(EditorContext, ({ editor }): EditorHandle => {
    let unregisterMountedView: (() => void) | undefined
    let mountedElement: HTMLElement | null = null
    return {
      mount: (el: HTMLElement | null) => {
        if (el === mountedElement) return
        if (el) {
          withNodeViewStoreForEditorConstruction(nodeViewStore, () =>
            editor.mount(el),
          )
          unregisterMountedView?.()
          unregisterMountedView = registerNodeViewStoreForEditorView(
            editor.view,
            nodeViewStore,
          )
        } else {
          unregisterMountedView?.()
          unregisterMountedView = undefined
          editor.unmount()
        }
        mountedElement = el
      },
      _internal: { editor, nodeViewStore },
    }
  })

export { makeEditorHandle, type EditorHandle }
