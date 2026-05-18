import { Result } from "@effect-atom/atom"
import { describe, expect, it } from "vitest"
import * as EditorAtom from "../../src/EditorAtom"
import { makeEditorRegistry } from "../helpers/registry"

describe("editor slice atoms", () => {
  it("exposes editor instance and document projections", () => {
    const { id, registry } = makeEditorRegistry()
    registry.mount(EditorAtom.mounted(id))

    expect(registry.get(EditorAtom.instance(id))).not.toBeNull()
    expect(registry.get(EditorAtom.text(id))).toBe("Hello")
    expect(registry.get(EditorAtom.html(id))).toBe("<p>Hello</p>")
    expect(registry.get(EditorAtom.json(id))?.type).toBe("doc")
  })

  it("updates document slices after setContent", () => {
    const { id, registry } = makeEditorRegistry()
    registry.mount(EditorAtom.events(id))

    registry.set(EditorAtom.setContent, {
      id,
      content: "<p>Changed</p>",
    })

    const result = registry.get(EditorAtom.setContent)
    expect(Result.isSuccess(result)).toBe(true)
    expect(registry.get(EditorAtom.text(id))).toBe("Changed")
    expect(registry.get(EditorAtom.html(id))).toBe("<p>Changed</p>")
  })

  it("reads and writes editable state", () => {
    const { id, registry } = makeEditorRegistry()
    registry.mount(EditorAtom.events(id))

    expect(registry.get(EditorAtom.isEditable(id))).toBe(true)
    registry.set(EditorAtom.isEditable(id), false)
    expect(registry.get(EditorAtom.isEditable(id))).toBe(false)

    registry.set(EditorAtom.setEditable, { id, editable: true })
    expect(registry.get(EditorAtom.isEditable(id))).toBe(true)
  })
})

