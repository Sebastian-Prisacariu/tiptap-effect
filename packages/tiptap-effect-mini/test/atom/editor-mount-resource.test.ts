import { Result } from "@effect-atom/atom"
import { describe, expect, it } from "vitest"
import * as EditorAtom from "../../src/EditorAtom"
import { makeEditorRegistry } from "../helpers/registry"
import { settle } from "../helpers/settle"

describe("mounted editor resource", () => {
  it("does not mount when no element is available", () => {
    const { id, registry, tracker } = makeEditorRegistry()
    registry.mount(EditorAtom.mounted(id))

    const result = registry.get(EditorAtom.mounted(id))
    expect(Result.isSuccess(result)).toBe(true)
    expect(tracker.mounted).toBe(0)
    expect(registry.get(EditorAtom.isMounted(id))).toBe(false)
  })

  it("acquires mount and releases it through atom scope", async () => {
    const { id, registry, tracker } = makeEditorRegistry()
    const element = document.createElement("div")
    registry.set(EditorAtom.mountElement(id), element)

    const unmount = registry.mount(EditorAtom.mounted(id))
    registry.get(EditorAtom.mounted(id))
    await settle()

    expect(tracker.mounted).toBe(1)
    expect(registry.get(EditorAtom.isMounted(id))).toBe(true)
    expect(element.querySelector(".ProseMirror")).not.toBeNull()

    unmount()
    await settle()
    expect(tracker.unmounted).toBe(1)
  })

  it("releases old mount before acquiring a new element", async () => {
    const { id, registry, tracker } = makeEditorRegistry()
    const first = document.createElement("div")
    const second = document.createElement("div")
    const unmount = registry.mount(EditorAtom.mounted(id))

    registry.set(EditorAtom.mountElement(id), first)
    registry.get(EditorAtom.mounted(id))
    await settle()
    registry.set(EditorAtom.mountElement(id), second)
    registry.get(EditorAtom.mounted(id))
    await settle()

    expect(tracker.mounted).toBe(2)
    expect(tracker.unmounted).toBeGreaterThanOrEqual(1)
    expect(first.querySelector(".ProseMirror")).toBeNull()
    expect(second.querySelector(".ProseMirror")).not.toBeNull()

    unmount()
  })

  it("setting mount element to null releases the mount", async () => {
    const { id, registry, tracker } = makeEditorRegistry()
    const element = document.createElement("div")
    registry.set(EditorAtom.mountElement(id), element)
    registry.mount(EditorAtom.mounted(id))
    registry.get(EditorAtom.mounted(id))
    await settle()

    registry.set(EditorAtom.mountElement(id), null)
    registry.get(EditorAtom.mounted(id))
    await settle()

    expect(tracker.unmounted).toBeGreaterThanOrEqual(1)
    expect(registry.get(EditorAtom.isMounted(id))).toBe(false)
    expect(element.querySelector(".ProseMirror")).toBeNull()
  })
})
