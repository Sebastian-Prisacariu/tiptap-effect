import { Registry } from "@effect-atom/atom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeEditorAtom } from "tiptap-effect/editor"
import { defineEditorSchema } from "../src/schema/define"
import { BoldMark } from "../src/schema/marks"
import {
  DocNode,
  HeadingNode,
  ParagraphNode,
  TextNode,
} from "../src/schema/nodes"
import {
  canExecuteAtom,
  focusAtom,
  isActiveAtom,
  selectedNodeAtom,
  selectionAtom,
} from "tiptap-effect/editor"
import { ToggleMarkCommand } from "tiptap-effect/command/commands"
import { EditorId } from "tiptap-effect"
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

  it("selectedNodeAtom is non-null only for node selections", async () => {
    const id = EditorId("ed-selected-node-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const selectedNode = selectedNodeAtom(id)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepSelectedNode = registry.subscribe(selectedNode, () => {})
    const editorHandle = await waitForAtom(registry, editorAtom)
    editorHandle.mount(document.createElement("div"))

    editorHandle._internal.editor.commands.setTextSelection(1)
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.get(selectedNode)).toBeNull()

    editorHandle._internal.editor.commands.setNodeSelection(0)
    await new Promise((r) => setTimeout(r, 20))

    expect(registry.get(selectedNode)).toEqual({
      pos: 0,
      nodeType: "paragraph",
      attrs: {},
    })
  })

  it("canExecuteAtom projects whether an editor command can run", async () => {
    const id = EditorId("ed-can-execute-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const canToggleBold = canExecuteAtom(id, ToggleMarkCommand("bold"), undefined)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepCanExecute = registry.subscribe(canToggleBold, () => {})
    const editorHandle = await waitForAtom(registry, editorAtom)
    editorHandle.mount(document.createElement("div"))
    editorHandle._internal.editor.commands.setTextSelection({ from: 1, to: 1 })
    await new Promise((r) => setTimeout(r, 20))

    expect(registry.get(canToggleBold)).toBe(true)
  })

  it("focusAtom flips to true on focus and back to false on blur", async () => {
    const id = EditorId("ed-focus-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const focus = focusAtom(id)

    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepFocus = registry.subscribe(focus, () => {})
    const editorHandle = await waitForAtom(registry, editorAtom)
    const editor = editorHandle._internal.editor as unknown as {
      emit: (event: string, payload: unknown) => void
    }

    expect(registry.get(focus)).toBe(false)

    editor.emit("focus", { editor: editorHandle._internal.editor, event: null })
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.get(focus)).toBe(true)

    editorHandle._internal.editor.commands.insertContent("!")
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.get(focus)).toBe(true)

    editor.emit("blur", { editor: editorHandle._internal.editor, event: null })
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.get(focus)).toBe(false)
  })
})
