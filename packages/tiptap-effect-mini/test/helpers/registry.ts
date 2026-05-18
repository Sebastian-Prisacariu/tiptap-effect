import { Atom, Registry } from "@effect-atom/atom"
import * as EditorAtom from "../../src/EditorAtom"
import type * as Editor from "../../src/Editor"
import { editorOptions } from "./extensions"
import { makeTrackedFactory } from "./tracked-editor"

export const makeEditorRegistry = (
  id: Editor.Id = "editor",
  options: Editor.Options = editorOptions(),
) => {
  const tracked = makeTrackedFactory()
  const registry = Registry.make({
    initialValues: [
      Atom.initialValue(EditorAtom.options(id), options),
      Atom.initialValue(EditorAtom.factory, tracked.factory),
    ],
  })
  return { id, registry, ...tracked }
}

