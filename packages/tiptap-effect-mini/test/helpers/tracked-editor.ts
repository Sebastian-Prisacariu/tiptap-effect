import { Editor as NativeEditor } from "@tiptap/core"
import type * as Editor from "../../src/Editor"
import type { Factory } from "../../src/internal/editorAtom"

export interface EditorTracker {
  readonly instances: ReadonlyArray<NativeEditor>
  created: number
  mounted: number
  unmounted: number
  destroyed: number
  on: number
  off: number
}

export const makeTrackedFactory = (): {
  readonly tracker: EditorTracker
  readonly factory: Factory
} => {
  const instances: Array<NativeEditor> = []
  const tracker: EditorTracker = {
    instances,
    created: 0,
    mounted: 0,
    unmounted: 0,
    destroyed: 0,
    on: 0,
    off: 0,
  }

  const factory = (options: Editor.Options) => {
    tracker.created += 1
    const editor = new NativeEditor({ ...options, element: null })
    instances.push(editor)

    const mount = editor.mount.bind(editor)
    editor.mount = (element) => {
      tracker.mounted += 1
      return mount(element)
    }

    const unmount = editor.unmount.bind(editor)
    editor.unmount = () => {
      tracker.unmounted += 1
      return unmount()
    }

    const destroy = editor.destroy.bind(editor)
    editor.destroy = () => {
      tracker.destroyed += 1
      return destroy()
    }

    const on = editor.on.bind(editor)
    editor.on = (event, handler) => {
      tracker.on += 1
      return on(event, handler)
    }

    const off = editor.off.bind(editor)
    editor.off = (event, handler) => {
      tracker.off += 1
      return off(event, handler)
    }

    return editor
  }

  return { tracker, factory }
}

