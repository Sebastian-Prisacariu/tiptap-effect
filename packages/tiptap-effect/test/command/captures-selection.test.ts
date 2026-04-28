import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineEditorCommand } from "tiptap-effect/command"
import { CommandExecutor } from "tiptap-effect/command"
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

const validDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "abcdefghij" }] },
  ],
}

// A command that does NOT remember the user's selection in its own
// `reverseSetup`. We pass capturesSelection: true so the executor records the
// SelectionInfo at dispatch and restores it BEFORE running reverse.
const InsertWithoutSelectionMemory = defineEditorCommand({
  op: "test.insert.no-self-mem",
  description: ({ text }) => `Insert "${text}"`,
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ length: Schema.Number }),
  apply: (chain, { text }) => chain.insertContent(text),
  reverseSetup: (_state, { text }) => ({ length: text.length }),
  // applyReverse uses the CURRENT selection (which is where the executor
  // restored the cursor pre-reverse), then deletes `length` chars after it.
  applyReverse: (chain, _input, { length }) =>
    chain.command(({ tr, state, dispatch }) => {
      const from = state.selection.from
      tr.delete(from, from + length)
      if (dispatch) dispatch(tr)
      return true
    }),
  capturesSelection: true,
})

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

describe("CommandExecutor — capturesSelection", () => {
  it("records SelectionInfo on dispatch and restores it before running reverse", async () => {
    const id = EditorId("ed-capsel-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.focus()
    // Caret at pos 4 (between "abc" and "defghij")
    editor.commands.setTextSelection(4)

    const beforeText = editor.getText()

    // Dispatch the command — inserts "X" at pos 4
    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, InsertWithoutSelectionMemory, { text: "X" })
      }),
    )
    expect(editor.getText()).toContain("abcXdefghij")

    // Move the cursor somewhere else BEFORE undoing — if the executor didn't
    // restore the dispatch-time selection, applyReverse would use this cursor
    // and delete the wrong character.
    editor.commands.setTextSelection(1)

    // Undo
    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getText()).toBe(beforeText)

    // Verify the record carried a SelectionInfo
    const past = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    // After undo the past stack is empty; let's redo the run to inspect the
    // record once more.
    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, InsertWithoutSelectionMemory, { text: "Y" })
      }),
    )
    const past2 = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    expect(past2.length).toBeGreaterThan(0)
    const last = past2[past2.length - 1]!
    expect(last.selection).not.toBeNull()
    expect(last.selection?.kind).toBe("text")
    void past
  })
})
