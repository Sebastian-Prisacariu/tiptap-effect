import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
import { CommandHistory } from "tiptap-effect/command"
import { Sequence } from "tiptap-effect/command"
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
  await runtime.dispose()
  registry.dispose()
})

describe("Sequence — nested", () => {
  it("a Sequence inside a Sequence records as ONE history entry; one undo reverts the whole tree", async () => {
    const id = EditorId("ed-seq-nested-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    const beforeText = editor.getText()

    // Inner atomics each fuse two inserts into one PM transaction.
    const InnerAB = Sequence.atomic(
      "test.inner-ab",
      [commands.insertText, commands.insertText] as const,
      () => "AB",
    )
    const InnerCD = Sequence.atomic(
      "test.inner-cd",
      [commands.insertText, commands.insertText] as const,
      () => "CD",
    )

    // Outer sequential composes the two inner sequences (a Command-of-Commands).
    const Outer = Sequence.sequential(
      "test.outer",
      [InnerAB, InnerCD] as const,
      () => "Outer",
    )

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, Outer, [
          [{ text: "A" }, { text: "B" }],
          [{ text: "C" }, { text: "D" }],
        ] as const)
      }),
    )

    expect(editor.getText()).toContain("A")
    expect(editor.getText()).toContain("B")
    expect(editor.getText()).toContain("C")
    expect(editor.getText()).toContain("D")

    // Exactly ONE history entry — the outer Sequence — even though four
    // logical inserts happened across two inner sequences.
    const past = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    expect(past.length).toBe(1)
    expect(past[0]!.op).toBe("test.outer")

    // ONE undo reverts the entire tree.
    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )

    expect(editor.getText()).toBe(beforeText)
  })
})
