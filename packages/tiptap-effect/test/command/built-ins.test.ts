import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
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
const commands = defineEditorCommands(lessonSchema)

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

let registry: Registry.Registry
let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor, never>

beforeEach(() => {
  registry = Registry.make()
  runtime = ManagedRuntime.make(CommandExecutor.Default as Layer.Layer<CommandExecutor>)
})

afterEach(async () => {
  await runtime.dispose()
  registry.dispose()
})

describe("Built-in commands", () => {
  it("InsertTextCommand inserts then undo deletes", async () => {
    const id = EditorId("ed-insert")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.insertText, { text: "X" })
      }),
    )
    expect(editor.getText()).toContain("X")
    const afterInsert = editor.getText()

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getText()).not.toBe(afterInsert)
    expect(editor.getText()).not.toContain("X")
  })

  it("SetContentCommand replaces doc; undo restores prior content", async () => {
    const id = EditorId("ed-setcontent")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))

    const before = editor.getJSON()

    const newDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "replaced" }] }],
    } as const

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.setContent, { content: newDoc })
      }),
    )
    expect(editor.getText()).toBe("replaced")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getJSON()).toEqual(before)
  })

  it("DeleteNodeAtCommand deletes a node and undo restores the document", async () => {
    const id = EditorId("ed-delete-node-at")
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    }
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: doc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    const before = editor.getJSON()
    let secondParagraphPos = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "second") {
        secondParagraphPos = pos
      }
    })

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.deleteNodeAt, { pos: secondParagraphPos })
      }),
    )
    expect(editor.getText()).toBe("first")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getJSON()).toEqual(before)
  })

  it("ReplaceNodeAtCommand replaces an upload-like node and undo restores it", async () => {
    const id = EditorId("ed-replace-node-at")
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "upload pending" }] },
      ],
    }
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: doc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    const before = editor.getJSON()
    let paragraphPos = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") paragraphPos = pos
    })

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.replaceNodeAt, {
          pos: paragraphPos,
          content: {
            type: "paragraph",
            content: [{ type: "text", text: "resolved media" }],
          },
        })
      }),
    )
    expect(editor.getText()).toBe("resolved media")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getJSON()).toEqual(before)
  })
})
