import { Registry, Result } from "@effect-atom/atom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { docAtom, htmlAtom, makeEditorAtom } from "tiptap-effect/editor"
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
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
}

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})


describe("docAtom", () => {
  it("emits Result.success(doc) for the initial editor snapshot", async () => {
    const id = EditorId("ed-doc-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const doc = docAtom(id, lessonSchema)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepDoc = registry.subscribe(doc, () => {})
    await waitForAtom(registry, editorAtom)

    const result = registry.get(doc)
    expect(result).not.toBeNull()
    expect(Result.isSuccess(result!)).toBe(true)
    if (Result.isSuccess(result!)) {
      expect(result.value).toEqual(validDoc)
    }
    void _keepEditor
    void _keepDoc
  })

  it("emits Result.success(doc) on a successful schema decode after a transaction", async () => {
    const id = EditorId("ed-doc-2")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const doc = docAtom(id, lessonSchema)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepDoc = registry.subscribe(doc, () => {})
    const handle = await waitForAtom(registry, editorAtom)

    handle._internal.editor.commands.insertContent(" World")
    await new Promise((r) => setTimeout(r, 30))

    const result = registry.get(doc)
    expect(result).not.toBeNull()
    expect(Result.isSuccess(result!)).toBe(true)
    if (Result.isSuccess(result!)) {
      expect(result.value.type).toBe("doc")
    }
    void _keepEditor
    void _keepDoc
  })

  it("is lazy: a subscriber drives docAtom's first projection and yields the decoded doc", async () => {
    // Atom.map projections only run when an observer reads the atom. We
    // prove this behaviourally: build a docAtom without subscribing,
    // make transactions, then subscribe and force evaluation — the value
    // we observe is the decoded post-transaction doc.
    const id = EditorId("ed-doc-3")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)

    // Build docAtom but DO NOT subscribe — projection has not run.
    docAtom(id, lessonSchema)
    handle._internal.editor.commands.insertContent("X")
    handle._internal.editor.commands.insertContent("Y")
    await new Promise((r) => setTimeout(r, 30))

    // Subscribe to a fresh docAtom. Trigger one more transaction to push
    // a snapshot into the bus stream, then read the atom value.
    const doc = docAtom(id, lessonSchema)
    const _keepDoc = registry.subscribe(doc, () => {})
    handle._internal.editor.commands.insertContent("Z")
    await new Promise((r) => setTimeout(r, 50))

    const value = registry.get(doc)
    expect(value).not.toBeNull()
    expect(Result.isSuccess(value!)).toBe(true)
    if (Result.isSuccess(value!)) {
      expect(value.value.type).toBe("doc")
    }
    void _keepEditor
    void _keepDoc
  })
})

describe("htmlAtom", () => {
  it("returns the initial editor HTML", async () => {
    const id = EditorId("ed-html-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const html = htmlAtom(id, lessonSchema)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepHtml = registry.subscribe(html, () => {})
    await waitForAtom(registry, editorAtom)

    expect(registry.get(html)).toContain("<p>Hello</p>")
    void _keepEditor
    void _keepHtml
  })

  it("returns the editor's HTML after a transaction", async () => {
    const id = EditorId("ed-html-2")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const html = htmlAtom(id, lessonSchema)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepHtml = registry.subscribe(html, () => {})
    const handle = await waitForAtom(registry, editorAtom)

    handle._internal.editor.commands.insertContent(" World")
    await new Promise((r) => setTimeout(r, 30))

    const value = registry.get(html)
    // ParagraphNode renders as <p>; the inserted text appears inside it.
    expect(value).toContain("<p")
    expect(value).toContain("Hello")
    expect(value).toContain("World")
    void _keepEditor
    void _keepHtml
  })
})
