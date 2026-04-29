import { Atom, Registry } from "@effect-atom/atom"
import { Node as TiptapNodeExt } from "@tiptap/core"
import type { Extensions } from "@tiptap/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeEditorAtom } from "tiptap-effect/editor"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})

describe("editorPropsAtom — surgical update (no rebuild)", () => {
  it("updates editorProps via editor.setOptions on atom change without destroying the editor", async () => {
    const propsAtom = Atom.make<Record<string, unknown>>({
      attributes: { class: "ed-v1" },
    })
    const id = EditorId("ed-props-1")

    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
      editorPropsAtom: propsAtom,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    const destroySpy = vi.spyOn(editor, "destroy")
    const setOptionsSpy = vi.spyOn(editor, "setOptions")

    registry.set(propsAtom, { attributes: { class: "ed-v2" } })
    await new Promise((r) => setTimeout(r, 20))

    expect(setOptionsSpy).toHaveBeenCalled()
    expect(destroySpy).not.toHaveBeenCalled()
    void _keep
  })
})

describe("extensionsAtom — rebuild on change", () => {
  it("destroys the existing editor and creates a fresh one when the extensions atom emits a new value", async () => {
    // Custom extension we can swap in/out to force a rebuild without
    // colliding with schema-declared node/mark names.
    const ExtA = TiptapNodeExt.create({
      name: "extA",
      group: "block",
      content: "inline*",
      parseHTML: () => [{ tag: "div.a" }],
      renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
        ["div", HTMLAttributes, 0],
    })
    const ExtB = TiptapNodeExt.create({
      name: "extB",
      group: "block",
      content: "inline*",
      parseHTML: () => [{ tag: "div.b" }],
      renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
        ["div", HTMLAttributes, 0],
    })

    const extsAtom = Atom.make<Extensions>([ExtA])
    const id = EditorId("ed-exts-1")

    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
      extensionsAtom: extsAtom,
    })
    const _keep = registry.subscribe(editorAtom, () => {})

    const handleV1 = await waitForAtom(registry, editorAtom)
    const editorV1 = handleV1._internal.editor
    const destroyV1Spy = vi.spyOn(editorV1, "destroy")

    // Regression guard: unmounted Tiptap editors report isDestroyed=true even
    // before destroy() is called. Rebuild cleanup must still call destroy().
    expect(editorV1.isDestroyed).toBe(true)

    // Sanity: the v1 editor knows about extA but not extB.
    expect(editorV1.schema.nodes["extA"]).toBeDefined()
    expect(editorV1.schema.nodes["extB"]).toBeUndefined()

    // Listen for a new Success whose handle differs from V1.
    const nextHandle = await new Promise<typeof handleV1>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("editor did not rebuild within 1000ms")),
        1000,
      )
      const unsub = registry.subscribe(editorAtom, (r) => {
        if (
          r._tag === "Success"
          && r.value._internal.editor !== editorV1
        ) {
          clearTimeout(timeout)
          unsub()
          resolve(r.value)
        }
      })
      registry.set(extsAtom, [ExtB])
    })
    const editorV2 = nextHandle._internal.editor

    // Rebuild semantics: V2 is a different editor instance, V1 was
    // destroyed during the swap, and V2's PM schema reflects the new
    // extensions list.
    expect(editorV2).not.toBe(editorV1)
    expect(destroyV1Spy).toHaveBeenCalledTimes(1)
    expect(editorV1.isDestroyed).toBe(true)
    expect(editorV2.schema.nodes["extA"]).toBeUndefined()
    expect(editorV2.schema.nodes["extB"]).toBeDefined()
    void _keep
  })
})
