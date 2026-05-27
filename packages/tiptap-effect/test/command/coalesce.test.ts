import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
import { CommandHistory } from "tiptap-effect/command"
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
let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor | CommandHistory, never>

beforeEach(() => {
  registry = Registry.make()
  runtime = ManagedRuntime.make(
    Layer.merge(CommandExecutor.Default, CommandHistory.Default) as Layer.Layer<
      CommandExecutor | CommandHistory
    >,
  )
})

afterEach(async () => {
  registry.dispose()
  await runtime.dispose()
})

describe("CommandExecutor — coalescing", () => {
  it("10 single-char InsertText calls within 500ms produce ONE history entry", async () => {
    const id = EditorId("ed-coalesce-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        for (const ch of "0123456789") {
          yield* exec.run(editor, commands.insertText, { text: ch })
        }
      }),
    )

    expect(editor.getText()).toContain("0123456789")

    const past = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    expect(past.length).toBe(1)
    // The merged record's input should reflect the full typed string.
    expect(past[0]!.input).toEqual({ text: "0123456789" })
  })

  it("undo of a coalesced run reverts the entire merged range in one shot", async () => {
    const id = EditorId("ed-coalesce-2")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)
    const before = editor.getText()

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        for (const ch of "wxyz") {
          yield* exec.run(editor, commands.insertText, { text: ch })
        }
        // Single undo should peel the merged record off
        yield* exec.undo(editor)
      }),
    )

    expect(editor.getText()).toBe(before)
  })

  it("an undo BREAKS the coalescing window — typing after Cmd-Z starts a new entry", async () => {
    const id = EditorId("ed-coalesce-3")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        // First run of inserts (will coalesce together)
        yield* exec.run(editor, commands.insertText, { text: "a" })
        yield* exec.run(editor, commands.insertText, { text: "b" })
        // Undo — pops the merged "ab" entry
        yield* exec.undo(editor)
        // Type a new char — should NOT coalesce with the redo-future entry
        yield* exec.run(editor, commands.insertText, { text: "c" })
        yield* exec.run(editor, commands.insertText, { text: "d" })
      }),
    )

    const past = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    expect(past.length).toBe(1)
    expect(past[0]!.input).toEqual({ text: "cd" })
  })
})
