import { Atom, Registry } from "@effect-atom/atom"
import { Effect } from "effect"
import { EditorContext } from "./context"

/**
 * Subscribe imperatively to `editorPropsAtom`. Each emission applies the new
 * editorProps via `editor.setOptions({ editorProps })` — no rebuild needed
 * because PM only consumes `editorProps` on each `dispatchTransaction`.
 */
const installEditorPropsSubscription = (
  editorPropsAtom: Atom.Writable<Record<string, unknown>> | undefined,
) =>
  Effect.gen(function* () {
    if (editorPropsAtom === undefined) return

    const { editor } = yield* EditorContext
    const registry = yield* Registry.AtomRegistry
    const unsubscribe = registry.subscribe(editorPropsAtom, (editorProps) => {
      ;(editor.setOptions as (opts: Record<string, unknown>) => void)({
        editorProps,
      })
    })
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
  })

export { installEditorPropsSubscription }
