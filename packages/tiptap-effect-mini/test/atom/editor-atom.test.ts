import { Registry, Result } from "@effect-atom/atom"
import { describe, expect, it } from "vitest"
import * as EditorAtom from "../../src/EditorAtom"
import * as EditorError from "../../src/EditorError"
import { makeEditorRegistry } from "../helpers/registry"
import { settle } from "../helpers/settle"

describe("EditorAtom.editor", () => {
  it("fails with OptionsMissing when options are not seeded", () => {
    const registry = Registry.make()
    const result = registry.get(EditorAtom.editor("missing"))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      const error = result.cause._tag === "Fail" ? result.cause.error : null
      expect(error).toBeInstanceOf(EditorError.OptionsMissing)
    }
  })

  it("creates and destroys an editor through the atom lifecycle", async () => {
    const { id, registry, tracker } = makeEditorRegistry()
    const unmount = registry.mount(EditorAtom.editor(id))

    const result = registry.get(EditorAtom.editor(id))
    expect(Result.isSuccess(result)).toBe(true)
    expect(tracker.created).toBe(1)

    unmount()
    registry.dispose()
    await settle()
    expect(tracker.destroyed).toBe(1)
  })

  it("refreshes to a new editor instance", async () => {
    const { id, registry, tracker } = makeEditorRegistry()
    registry.mount(EditorAtom.editor(id))
    const first = registry.get(EditorAtom.editor(id))
    expect(Result.isSuccess(first)).toBe(true)

    registry.set(EditorAtom.refresh, id)

    const second = registry.get(EditorAtom.editor(id))
    expect(Result.isSuccess(second)).toBe(true)
    expect(tracker.created).toBe(2)
    await settle()
    expect(tracker.destroyed).toBe(1)
  })
})
