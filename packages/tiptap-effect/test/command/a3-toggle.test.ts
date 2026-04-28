import { Registry } from "@effect-atom/atom"
import { Chunk, Effect, Layer, ManagedRuntime, PubSub, Queue, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type NotReversibleError, Reverse } from "../../src/command"
import { CommandExecutor, type NotReversibleAttempt } from "../../src/command-executor"
import { CommandHistory } from "../../src/command-history"
import { makeEditorAtom } from "../../src/editor"
import { defineEditorSchema } from "../../src/schema/define"
import { BoldMark } from "../../src/schema/marks"
import { DocNode, ParagraphNode, TextNode } from "../../src/schema/nodes"
import { EditorId } from "../../src/types"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

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
        return yield* hist.list()
      }),
    )
    expect(past.length).toBe(0)
  })
})
