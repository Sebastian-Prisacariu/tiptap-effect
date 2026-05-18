import { Atom, Result } from "@effect-atom/atom"
import {
  Editor as NativeEditor,
  type JSONContent,
  type SetContentOptions,
} from "@tiptap/core"
import { Effect, HashMap, Layer } from "effect"
import type * as Editor from "../Editor"
import * as EditorError from "../EditorError"
import * as editorEvent from "./editor"

const runtime = Atom.runtime(Layer.empty)
const bump = (n: number) => n + 1

export const options = Atom.family((id: Editor.Id) =>
  Atom.make<Editor.Options | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`editorOptions(${id})`),
  )
)

export const version = Atom.family((id: Editor.Id) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`editorVersion(${id})`))
)

export const documentVersion = Atom.family((id: Editor.Id) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`documentVersion(${id})`))
)

export const selectionVersion = Atom.family((id: Editor.Id) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`selectionVersion(${id})`))
)

export const focusVersion = Atom.family((id: Editor.Id) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`focusVersion(${id})`))
)

export const isMounted = Atom.family((id: Editor.Id) =>
  Atom.make(false).pipe(Atom.keepAlive, Atom.withLabel(`isMounted(${id})`))
)

export const mountElement = Atom.family((id: Editor.Id) =>
  Atom.make<HTMLElement | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mountElement(${id})`),
  )
)

export const editor = Atom.family((id: Editor.Id) =>
  runtime.atom((get) => {
    const editorOptions = get(options(id))
    if (editorOptions === null) {
      return Effect.fail(
        new EditorError.OptionsMissing({
          id,
          message: `tiptap-effect-mini: missing editor options for "${id}"`,
        }),
      )
    }

    return Effect.sync(() => {
      const instance = new NativeEditor({
        ...editorOptions,
        element: null,
      })

      get.addFinalizer(() => {
        if (!instance.isDestroyed) instance.destroy()
      })

      return instance
    })
  }).pipe(
    Atom.keepAlive,
    Atom.withLabel(`editor(${id})`),
  )
)

const getEditor = (
  id: Editor.Id,
  get: Atom.FnContext,
): Effect.Effect<Editor.Editor, EditorError.OptionsMissing> =>
  get.result(editor(id), { suspendOnWaiting: true })

const markTransaction = (get: Atom.FnContext, id: Editor.Id) => {
  get.set(version(id), bump(get(version(id))))
}

const markDocument = (get: Atom.FnContext, id: Editor.Id) => {
  get.set(documentVersion(id), bump(get(documentVersion(id))))
  markTransaction(get, id)
}

const markSelection = (get: Atom.FnContext, id: Editor.Id) => {
  get.set(selectionVersion(id), bump(get(selectionVersion(id))))
  markTransaction(get, id)
}

const markFocus = (get: Atom.FnContext, id: Editor.Id) => {
  get.set(focusVersion(id), bump(get(focusVersion(id))))
  markTransaction(get, id)
}

const refreshState = (
  get: Atom.FnContext,
  id: Editor.Id,
  refreshes: ReadonlyArray<Editor.RefreshKind> = ["transaction"],
) => {
  for (const refresh of refreshes) {
    if (refresh === "document") markDocument(get, id)
    else if (refresh === "selection") markSelection(get, id)
    else if (refresh === "focus") markFocus(get, id)
    else markTransaction(get, id)
  }
}

export const events = Atom.family((id: Editor.Id) =>
  Atom.make((get) => {
    const result = get(editor(id))
    if (!Result.isSuccess(result)) return result

    const instance = result.value
    const handlers = HashMap.fromIterable<Editor.Event, () => void>([
      ["transaction", () => markTransaction(get, id)],
      ["selectionUpdate", () => markSelection(get, id)],
      ["update", () => markDocument(get, id)],
      ["focus", () => markFocus(get, id)],
      ["blur", () => markFocus(get, id)],
      ["mount", () => markTransaction(get, id)],
      ["unmount", () => markTransaction(get, id)],
      ["create", () => markTransaction(get, id)],
      ["destroy", () => markTransaction(get, id)],
      ["contentError", () => markDocument(get, id)],
    ])

    HashMap.forEach(handlers, (handler, event) => {
      editorEvent.onEvent(instance, event, handler)
    })
    get.addFinalizer(() => {
      HashMap.forEach(handlers, (handler, event) => {
        editorEvent.offEvent(instance, event, handler)
      })
    })

    return result
  }).pipe(
    Atom.keepAlive,
    Atom.withLabel(`editorEvents(${id})`),
  )
)

export const snapshot = Atom.family((id: Editor.Id) =>
  Atom.make((get): Editor.Snapshot | null => {
    const result = get(editor(id))
    if (!Result.isSuccess(result)) return null

    get(events(id))
    return {
      editor: result.value,
      version: get(version(id)),
      documentVersion: get(documentVersion(id)),
      selectionVersion: get(selectionVersion(id)),
      focusVersion: get(focusVersion(id)),
    }
  }).pipe(Atom.withLabel(`editorSnapshot(${id})`))
)

export const slice = <T,>(
  id: Editor.Id,
  selector: (snapshot: Editor.Snapshot) => T,
): Atom.Atom<T | null> =>
  Atom.map(snapshot(id), (value) =>
    value === null ? null : selector(value)
  )

export const instance = (id: Editor.Id): Atom.Atom<Editor.Editor | null> =>
  slice(id, ({ editor }) => editor)

export const json = (id: Editor.Id): Atom.Atom<JSONContent | null> =>
  slice(id, ({ editor, documentVersion: _ }) => editor.getJSON())

export const html = (id: Editor.Id): Atom.Atom<string | null> =>
  slice(id, ({ editor, documentVersion: _ }) => editor.getHTML())

export const text = (id: Editor.Id): Atom.Atom<string | null> =>
  slice(id, ({ editor, documentVersion: _ }) => editor.getText())

export const isFocused = (id: Editor.Id): Atom.Atom<boolean> =>
  Atom.map(snapshot(id), (value) => value?.editor.isFocused ?? false)

export const isEditable = (id: Editor.Id): Atom.Writable<boolean, boolean> =>
  Atom.writable(
    (get) => {
      const current = get(instance(id))
      get(version(id))
      return current?.isEditable ?? false
    },
    (ctx, editable) => {
      const current = ctx.get(instance(id))
      if (!current) return
      current.setEditable(editable)
      ctx.set(version(id), bump(ctx.get(version(id))))
    },
    (refresh) => refresh(snapshot(id)),
  )

export const isActive = (
  id: Editor.Id,
  name: string,
  attributes?: Record<string, unknown>,
): Atom.Atom<boolean> =>
  slice(id, ({ editor, selectionVersion: _ }) =>
    editor.isActive(name, attributes)
  ).pipe(Atom.map((value) => value ?? false))

export const canRun = (
  id: Editor.Id,
  command: (editor: Editor.Editor) => boolean,
): Atom.Atom<boolean> =>
  slice(id, ({ editor, version: _ }) => command(editor)).pipe(
    Atom.map((value) => value ?? false),
  )

export const mounted = Atom.family((id: Editor.Id) =>
  runtime.atom((get) =>
    Effect.gen(function* () {
      const element = get(mountElement(id))
      if (element === null) {
        get.set(isMounted(id), false)
        return false
      }

      const current = yield* getEditor(id, get)
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          if (!current.isDestroyed) {
            current.unmount()
            current.mount(element)
          }
          get.set(isMounted(id), !current.isDestroyed)
          markTransaction(get, id)
          return current
        }),
        (mountedEditor) =>
          Effect.sync(() => {
            if (!mountedEditor.isDestroyed) {
              mountedEditor.unmount()
            }
          }),
      )
    }),
  ).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mountedEditor(${id})`),
  )
)

export const refresh = Atom.fnSync((id: Editor.Id, get) => {
  get.set(mountElement(id), null)
  get.refresh(editor(id))
  get.refresh(events(id))
  get.refresh(mounted(id))
  get.set(isMounted(id), false)
  markTransaction(get, id)
}).pipe(Atom.keepAlive, Atom.withLabel("refreshEditor"))

export const setOptions = Atom.fnSync((
  input: { readonly id: Editor.Id; readonly options: Editor.Options },
  get,
) => {
  get.set(mountElement(input.id), null)
  get.set(options(input.id), input.options)
  get.refresh(editor(input.id))
  get.refresh(events(input.id))
  get.refresh(mounted(input.id))
  get.set(isMounted(input.id), false)
  markTransaction(get, input.id)
}).pipe(Atom.keepAlive, Atom.withLabel("setEditorOptions"))

export const setContent = runtime.fn(
  Effect.fn(function* (
    input: {
      readonly id: Editor.Id
      readonly content: string | JSONContent
      readonly options?: SetContentOptions
    },
    get: Atom.FnContext,
  ) {
    const current = yield* getEditor(input.id, get)
    current.commands.setContent(input.content, input.options)
    markDocument(get, input.id)
  }),
).pipe(Atom.keepAlive, Atom.withLabel("setContent"))

export const setEditable = Atom.fnSync((
  input: { readonly id: Editor.Id; readonly editable: boolean; readonly emitUpdate?: boolean },
  get,
) => {
  const current = get(instance(input.id))
  if (!current) return
  current.setEditable(input.editable, input.emitUpdate ?? true)
  markTransaction(get, input.id)
}).pipe(Atom.keepAlive, Atom.withLabel("setEditable"))

export const run = runtime.fn<Editor.RunInput>()(
  Effect.fn(function* (
    input: Editor.RunInput,
    get: Atom.FnContext,
  ) {
    const current = yield* getEditor(input.id, get)
    const value = yield* input.run(current)
    refreshState(get, input.id, input.refresh)
    return value
  }),
).pipe(Atom.keepAlive, Atom.withLabel("runEditor"))

export const runSync = Atom.fnSync((
  input: Editor.RunSyncInput,
  get,
) => {
  const current = get(instance(input.id))
  if (!current) return
  const value = input.run(current)
  refreshState(get, input.id, input.refresh)
  return value
}).pipe(Atom.keepAlive, Atom.withLabel("runEditorSync"))

