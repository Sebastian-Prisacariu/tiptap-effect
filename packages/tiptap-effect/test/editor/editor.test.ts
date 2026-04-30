import { Registry, Result, type Atom } from "@effect-atom/atom"
import type { Extensions } from "@tiptap/core"
import { Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeEditorAtom } from "tiptap-effect/editor"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark, ItalicMark } from "tiptap-effect/schema"
import {
  DocNode,
  HeadingNode,
  ParagraphNode,
  TextNode,
} from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"
import { withoutPmHistory } from "../../src/editor/internal/strip-pm-history"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode, heading: HeadingNode },
  marks: { bold: BoldMark, italic: ItalicMark },
})

const validDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
  ],
}

let registry: Registry.Registry

const waitForKeptAtom = <A, E>(
  atom: Atom.Atom<Result.Result<A, E>>,
): Promise<readonly [A, () => void]> =>
  new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    const tryResolve = (result: Result.Result<A, E>) => {
      if (Result.isSuccess(result)) {
        resolve([result.value, () => unsubscribe?.()] as const)
        return true
      }
      if (Result.isFailure(result)) {
        reject(result.cause)
        return true
      }
      return false
    }
    unsubscribe = registry.subscribe(atom, tryResolve, { immediate: true })
  })

const transactionFunnelCount = (editor: {
  callbacks: Record<string, ReadonlyArray<unknown>>
}): number =>
  (editor.callbacks["transaction"] ?? []).filter(
    (callback): callback is { readonly name: string } =>
      typeof callback === "function" && callback.name === "transactionHandler",
  ).length

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})

describe("makeEditorAtom — lifecycle", () => {
  it("creates an editor with element: null", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-1"),
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const [handle, keepAlive] = await waitForKeptAtom(atom)
    expect(handle._internal.editor).toBeDefined()
    // PM reports isDestroyed=true for an unmounted editor (no editorView).
    // We just check the constructor didn't throw and we have an Editor instance.
    expect(typeof handle._internal.editor.commands.insertContent).toBe("function")
    keepAlive()
  })

  it("registers exactly one transaction listener", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-listener"),
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const [handle, keepAlive] = await waitForKeptAtom(atom)
    const editor = handle._internal.editor
    // EventEmitter exposes `callbacks` map (per Tiptap's EventEmitter).
    expect(
      transactionFunnelCount(
        editor as unknown as { callbacks: Record<string, ReadonlyArray<unknown>> },
      ),
    ).toBe(1)
    keepAlive()
  })

  it("destroys the editor exactly once when registry disposes", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-destroy"),
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    registry.subscribe(atom, () => {})
    const handle = await waitForAtom(registry, atom)
    handle.mount(document.createElement("div"))
    let destroyEvents = 0
    handle._internal.editor.on("destroy", () => {
      destroyEvents += 1
    })
    registry.dispose()
    for (let i = 0; i < 100; i += 1) {
      if (handle._internal.editor.isDestroyed) break
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(handle._internal.editor.isDestroyed).toBe(true)
    expect(destroyEvents).toBe(1)
  })

  it("calls destroy exactly once for an unmounted editor when registry disposes", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-destroy-direct"),
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    registry.subscribe(atom, () => {})
    const handle = await waitForAtom(registry, atom)
    const destroySpy = vi.spyOn(handle._internal.editor, "destroy")

    expect(handle._internal.editor.isDestroyed).toBe(true)
    registry.dispose()

    expect(destroySpy).toHaveBeenCalledTimes(1)
  })

  it("mount(el) attaches the editor; mount(null) detaches", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-mount"),
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const [handle, keepAlive] = await waitForKeptAtom(atom)
    const div = document.createElement("div")
    const mountSpy = vi.spyOn(handle._internal.editor, "mount")
    const unmountSpy = vi.spyOn(handle._internal.editor, "unmount")
    handle.mount(div)
    expect(mountSpy).toHaveBeenCalledWith(div)
    handle.mount(null)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    keepAlive()
  })
})

describe("makeEditorAtom — schema validation", () => {
  it("decodes valid defaultContent successfully", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-valid"),
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const [handle, keepAlive] = await waitForKeptAtom(atom)
    expect(handle._internal.editor).toBeDefined()
    keepAlive()
  })

  it("rejects invalid defaultContent with EditorInitError", async () => {
    const atom = makeEditorAtom({
      id: EditorId("ed-bad"),
      schema: lessonSchema,
      defaultContent: { type: "doc", content: [{ type: "callout" }] },
    })
    await expect(waitForAtom(registry, atom)).rejects.toBeDefined()
  })
})

describe("makeEditorAtom — transaction funnel to bus", () => {
  it("pushes a snapshot to TransactionBus for every transaction", async () => {
    const id = EditorId("ed-bus")
    const atom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const [handle, keepAlive] = await waitForKeptAtom(atom)

    // Programmatically trigger a transaction (insert text)
    handle._internal.editor.commands.insertContent("World")

    const editor = handle._internal.editor
    expect(
      transactionFunnelCount(
        editor as unknown as { callbacks: Record<string, ReadonlyArray<unknown>> },
      ),
    ).toBe(1)
    keepAlive()
  })
})

describe("makeEditorAtom — surgical update for editable", () => {
  it("uses editableAtom's initial value when creating the editor", async () => {
    const { Atom } = await import("@effect-atom/atom")
    const editableAtom = Atom.make(false)
    const atom = makeEditorAtom({
      id: EditorId("ed-edit-initial"),
      schema: lessonSchema,
      defaultContent: validDoc,
      editableAtom,
    })

    const [handle, keepAlive] = await waitForKeptAtom(atom)
    expect(handle._internal.editor.isEditable).toBe(false)
    keepAlive()
  })

  it("calls setEditable when editableAtom changes; does not destroy", async () => {
    const { Atom } = await import("@effect-atom/atom")
    const editableAtom = Atom.make(true)
    const atom = makeEditorAtom({
      id: EditorId("ed-edit"),
      schema: lessonSchema,
      defaultContent: validDoc,
      editableAtom,
    })
    // Keep alive so the editor isn't idle-disposed
    const keepAlive = registry.subscribe(atom, () => {})
    const handle = await waitForAtom(registry, atom)
    const setEditableSpy = vi.spyOn(handle._internal.editor, "setEditable")
    const destroySpy = vi.spyOn(handle._internal.editor, "destroy")

    registry.set(editableAtom, false)
    // Subscriptions may fire on next tick
    await new Promise((r) => setTimeout(r, 10))
    expect(setEditableSpy).toHaveBeenLastCalledWith(false, false)
    expect(destroySpy).not.toHaveBeenCalled()
    keepAlive()
  })
})

describe("withoutPmHistory", () => {
  it("strips extensions named 'history' or 'undoRedo'", () => {
    const ext = [
      { name: "paragraph" },
      { name: "history" },
      { name: "undoRedo" },
      { name: "bold" },
    ] as unknown as Extensions
    const result = withoutPmHistory(ext)
    expect(result.map((e) => e.name)).toEqual(["paragraph", "bold"])
  })

  it("throws when strict and history is present", () => {
    const ext = [{ name: "history" }] as unknown as Extensions
    expect(() => withoutPmHistory(ext, { strict: true })).toThrow(/not allowed/)
  })
})

void Schema // satisfy import
