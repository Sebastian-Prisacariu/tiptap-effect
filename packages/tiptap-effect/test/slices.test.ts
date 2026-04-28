import { Registry } from "@effect-atom/atom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeEditorAtom } from "../src/editor"
import { defineEditorSchema } from "../src/schema/define"
import { BoldMark } from "../src/schema/marks"
import {
  DocNode,
  HeadingNode,
  ParagraphNode,
  TextNode,
} from "../src/schema/nodes"
import { isActiveAtom, selectionAtom } from "../src/slices"
import { EditorId } from "../src/types"
import { waitForAtom } from "./helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode, heading: HeadingNode },
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

describe("slices", () => {
  it("selectionAtom is null before any transaction", async () => {
    const id = EditorId("ed-sel-1")
    const editor = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const sel = selectionAtom(id)

    const _keepEditor = registry.subscribe(editor, () => {})
    const _keepSel = registry.subscribe(sel, () => {})
    await waitForAtom(registry, editor)

    // No transaction has been pushed yet → null
    const value = registry.get(sel)
    expect(value).toBeNull()
  })

  it("selectionAtom updates on text editor transactions", async () => {
    const id = EditorId("ed-sel-2")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const sel = selectionAtom(id)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepSel = registry.subscribe(sel, () => {})
    const editorHandle = await waitForAtom(registry, editorAtom)

    // Trigger a transaction
    editorHandle._internal.editor.commands.insertContent(" World")
    await new Promise((r) => setTimeout(r, 20))

    const value = registry.get(sel)
    expect(value).not.toBeNull()
    expect(value!.kind).toBe("text")
  })

  it("isActiveAtom('bold') is false initially", async () => {
    const id = EditorId("ed-bold-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const bold = isActiveAtom(id, "bold")

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepBold = registry.subscribe(bold, () => {})
    await waitForAtom(registry, editorAtom)

    const value = registry.get(bold)
    expect(value).toBe(false)
  })
})
