import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor } from "tiptap-effect/command"
import { InsertTextCommand, SetContentCommand } from "tiptap-effect/command/commands"
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
        yield* exec.run(editor, InsertTextCommand, { text: "X" })
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
    }

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, SetContentCommand, { content: newDoc })
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
})
