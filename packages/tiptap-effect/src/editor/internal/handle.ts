import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect } from "effect"
import { EditorContext } from "./context"
import {
  ReactPortalRegistry,
  registerReactPortalRegistryForEditorView,
  withReactPortalRegistryForEditorConstruction,
} from "./react-portal-registry"

interface EditorHandle {
  readonly mount: (el: HTMLElement | null) => void
  readonly _internal: {
    readonly editor: TiptapEditor
    readonly reactPortals: ReactPortalRegistry
  }
}

const makeEditorHandle = (reactPortals: ReactPortalRegistry) =>
  Effect.map(EditorContext, ({ editor }): EditorHandle => {
    let unregisterMountedView: (() => void) | undefined
    let mountedElement: HTMLElement | null = null
    return {
      mount: (el: HTMLElement | null) => {
        if (el === mountedElement) return
        if (el) {
          withReactPortalRegistryForEditorConstruction(reactPortals, () =>
            editor.mount(el),
          )
          unregisterMountedView?.()
          unregisterMountedView = registerReactPortalRegistryForEditorView(
            editor.view,
            reactPortals,
          )
        } else {
          unregisterMountedView?.()
          unregisterMountedView = undefined
          editor.unmount()
        }
        mountedElement = el
      },
      _internal: { editor, reactPortals },
    }
  })

export { makeEditorHandle, type EditorHandle }
