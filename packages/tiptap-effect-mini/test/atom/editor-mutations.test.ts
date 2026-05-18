import { Result } from "@effect-atom/atom"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import * as EditorAtom from "../../src/EditorAtom"
import { editorOptions } from "../helpers/extensions"
import { makeEditorRegistry } from "../helpers/registry"
import { settle } from "../helpers/settle"

describe("editor mutation atoms", () => {
  it("runs sync editor work", () => {
    const { id, registry } = makeEditorRegistry()
    registry.mount(EditorAtom.events(id))

    registry.set(EditorAtom.runSync, {
      id,
      run: (editor) => editor.commands.setContent("<p>Sync</p>"),
      refresh: ["document"],
    })

    expect(registry.get(EditorAtom.text(id))).toBe("Sync")
  })

  it("runs Effect editor work", () => {
    const { id, registry } = makeEditorRegistry()
    registry.mount(EditorAtom.events(id))

    registry.set(EditorAtom.run, {
      id,
      run: (editor) =>
        Effect.sync(() => {
          editor.commands.setContent("<p>Effect</p>")
        }),
      refresh: ["document"],
    })

    const result = registry.get(EditorAtom.run)
    expect(Result.isSuccess(result)).toBe(true)
    expect(registry.get(EditorAtom.text(id))).toBe("Effect")
  })

  it("rebuilds on setOptions", async () => {
    const { id, registry, tracker } = makeEditorRegistry()
    registry.mount(EditorAtom.editor(id))
    expect(tracker.created).toBe(1)

    registry.set(EditorAtom.setOptions, {
      id,
      options: editorOptions("<p>Rebuilt</p>"),
    })

    expect(tracker.created).toBe(2)
    await settle()
    expect(tracker.destroyed).toBe(1)
    expect(registry.get(EditorAtom.text(id))).toBe("Rebuilt")
  })
})
