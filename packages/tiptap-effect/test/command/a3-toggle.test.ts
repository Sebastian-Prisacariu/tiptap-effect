import { Registry } from "@effect-atom/atom"
import { Chunk, Effect, Layer, ManagedRuntime, PubSub, Queue, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type NotReversibleError, Reverse } from "tiptap-effect/command"
import { CommandExecutor, defineEditorCommands, type NotReversibleAttempt } from "tiptap-effect/command"
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

const SendEmailCmd = {
  op: "test.send.email" as const,
  description: () => "Send email",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  forward: () => Effect.succeed({}),
  reverse: Reverse.notReversible,
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

describe("CommandExecutor — A3 toggle", () => {
  it("first undo against notReversible emits a CanonicalToast event AND fails; second undo within window pops + recurses", async () => {
    const id = EditorId("ed-a3-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    type FirstResult = { _tag: "Left"; left: NotReversibleError } | { _tag: "Right"; right: unknown }
    type SecondResult = { _tag: "Left"; left: NotReversibleError } | { _tag: "Right"; right: unknown }

    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          const queue = yield* PubSub.subscribe(exec.notReversibleEvents)

          yield* exec.run(editor, SendEmailCmd, undefined)
          const firstAttempt = (yield* Effect.either(exec.undo(editor))) as FirstResult
          // Drain events emitted between dispatch and first undo
          const eventsAfterFirst = Chunk.toReadonlyArray(
            yield* Queue.takeAll(queue),
          ) as ReadonlyArray<NotReversibleAttempt>
          // Second undo within the 3s window: should pop + recurse silently
          const secondAttempt = (yield* Effect.either(exec.undo(editor))) as SecondResult
          const eventsAfterSecond = Chunk.toReadonlyArray(
            yield* Queue.takeAll(queue),
          ) as ReadonlyArray<NotReversibleAttempt>

          return { firstAttempt, secondAttempt, eventsAfterFirst, eventsAfterSecond }
        }),
      ),
    )

    expect(result.firstAttempt._tag).toBe("Left")
    if (result.firstAttempt._tag === "Left") {
      expect(result.firstAttempt.left._tag).toBe("NotReversibleError")
    }

    expect(result.secondAttempt._tag).toBe("Right")

    // Exactly one toast event was emitted (only on the FIRST attempt)
    expect(result.eventsAfterFirst.length).toBe(1)
    expect(result.eventsAfterFirst[0]!.op).toBe("test.send.email")
    expect(result.eventsAfterSecond.length).toBe(0)

    // Stack drained
    const past = await runtime.runPromise(
      Effect.gen(function* () {
        const hist = yield* CommandHistory
        return yield* hist.list(id)
      }),
    )
    expect(past.length).toBe(0)
  })

  it("a blocked notReversible undo preserves redo history", async () => {
    const id = EditorId("ed-a3-redo")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, SendEmailCmd, undefined)
        yield* exec.run(editor, commands.insertText, { text: "X" })
        yield* exec.undo(editor)
        const blocked = yield* Effect.either(exec.undo(editor))
        const redone = yield* exec.redo(editor)
        return { blocked, redone }
      }),
    )

    expect(result.blocked._tag).toBe("Left")
    expect(result.redone?.op).toBe("tiptap-effect.insert.text")
    expect(editor.getText()).toContain("X")
  })
})
