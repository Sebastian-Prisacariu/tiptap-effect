import { Atom, Registry } from "@effect-atom/atom"
import { Effect } from "effect"
import { EditorContext } from "./context"

const installEditableSubscription = (
  editableAtom: Atom.Writable<boolean> | undefined,
) =>
  Effect.gen(function* () {
    if (editableAtom === undefined) return

    const { editor } = yield* EditorContext
    const registry = yield* Registry.AtomRegistry
    const unsubscribe = registry.subscribe(editableAtom, (editable) => {
      editor.setEditable(editable, false)
    })
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
  })

export { installEditableSubscription }
