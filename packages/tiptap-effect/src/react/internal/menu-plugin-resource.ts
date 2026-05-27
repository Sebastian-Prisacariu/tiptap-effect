import type { Editor } from "@tiptap/core"
import type { Plugin, PluginKey } from "@tiptap/pm/state"
import { Effect, Scope } from "effect"

export interface MenuPluginResource {
  readonly editor: Editor
  readonly element: HTMLElement
  readonly plugin: Plugin
  readonly pluginKey: PluginKey | string
}

const removeElementOnNextFrame = (element: HTMLElement): void => {
  const remove = () => element.parentNode?.removeChild(element)
  if (typeof window === "undefined") {
    remove()
    return
  }
  window.requestAnimationFrame(remove)
}

export const acquireMenuPlugin = ({
  editor,
  element,
  plugin,
  pluginKey,
}: MenuPluginResource): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      editor.registerPlugin(plugin)
    }),
    () =>
      Effect.sync(() => {
        if (!editor.isDestroyed) {
          editor.unregisterPlugin(pluginKey)
        }
        removeElementOnNextFrame(element)
      }),
  )
