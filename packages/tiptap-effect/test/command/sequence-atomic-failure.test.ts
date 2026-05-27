import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineEditorCommand } from "tiptap-effect/command"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
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

// A step whose chain command always returns false. PM treats a chain in which
// any step returns false as a failed chain — `chain.run()` returns false and
// NO transaction is committed. That gives Sequence.atomic its "all-or-nothing"
// guarantee at the PM layer.
const FailingStep = defineEditorCommand({
  op: "test.failing-step",
  description: () => "Failing step",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  apply: (chain) =>
    chain.command(({ dispatch }) => {
      void dispatch
      return false
    }),
  reverseSetup: () => ({}),
  applyReverse: (chain) => chain,
})

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

describe("Sequence.atomic — failure semantics", () => {
  it("a step that fails inside the chain leaves the editor in its original state (no partial commit visible)", async () => {
    const id = EditorId("ed-seq-fail-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    const beforeText = editor.getText()
    const beforeJSON = JSON.stringify(editor.getJSON())

    const InsertThenFail = Sequence.atomic(
      "test.insert-then-fail",
      [commands.insertText, FailingStep] as const,
      () => "Insert then fail",
    )

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        // chain.run() returns false → Sequence.atomic fails with
        // SequenceFailure AND restores the doc to its pre-chain state.
        return yield* Effect.either(
          exec.run(editor, InsertThenFail, [{ text: "X" }, undefined] as const),
        )
      }),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("SequenceFailure")
    }

    // Atomicity invariant: NO partial commit visible
    expect(editor.getText()).toBe(beforeText)
    expect(JSON.stringify(editor.getJSON())).toBe(beforeJSON)
    expect(editor.getText()).not.toContain("X")
  })
})
