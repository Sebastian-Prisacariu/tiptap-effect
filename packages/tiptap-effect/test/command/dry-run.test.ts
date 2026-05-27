import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Reverse } from "tiptap-effect/command"
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

describe("CommandExecutor.dryRun", () => {
  it("runs forward + reverse and leaves doc + history unchanged", async () => {
    const id = EditorId("ed-dry-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)
    const beforeText = editor.getText()
    const beforeJSON = JSON.stringify(editor.getJSON())

    const out = await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.dryRun(editor, commands.insertText, { text: "preview" })
      }),
    )

    // forward+reverse should round-trip the doc to the prior state
    expect(editor.getText()).toBe(beforeText)
    expect(JSON.stringify(editor.getJSON())).toBe(beforeJSON)
    // dryRun returns the captured output of forward
    expect(out.length).toBe("preview".length)

    const past = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    expect(past.length).toBe(0)
  })

  it("fails with NotReversibleError when the command's reverse is the notReversible sentinel", async () => {
    const id = EditorId("ed-dry-2")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    const NotReversibleCmd = {
      op: "test.send.email" as const,
      description: () => "Send email",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.succeed({}),
      reverse: Reverse.notReversible,
    }

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* Effect.either(exec.dryRun(editor, NotReversibleCmd, undefined))
      }),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("NotReversibleError")
    }
  })
})
