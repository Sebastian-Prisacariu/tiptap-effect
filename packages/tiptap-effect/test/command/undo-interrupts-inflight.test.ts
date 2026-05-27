import { Registry, Result } from "@effect-atom/atom"
import { Effect, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineCommand, Reverse } from "tiptap-effect/command"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
import { makeEditorAtom } from "tiptap-effect/editor"
import { editorRuntime } from "tiptap-effect/runtime"
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

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})

const runViaRuntime = <A, E>(
  reg: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Promise<A> => {
  const oneShot = editorRuntime.atom(effect)
  return new Promise<A>((resolve, reject) => {
    const tryResolve = (r: Result.Result<A, E>) => {
      if (Result.isSuccess(r)) {
        unsub()
        resolve(r.value)
        return true
      }
      if (Result.isFailure(r)) {
        unsub()
        reject(r.cause as unknown)
        return true
      }
      return false
    }
    const unsub = reg.subscribe(oneShot, tryResolve)
    if (tryResolve(reg.get(oneShot))) return
  })
}

describe("CommandExecutor.undo — interrupts in-flight commands first", () => {
  it("Cmd-Z while a Command is in-flight: in-flight fiber interrupted; undo proceeds with the prior history entry", async () => {
    const id = EditorId("ed-undo-int-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    // First, dispatch a quick command so there's a previous history entry.
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.insertText, { text: "X" })
      }),
    )
    const afterX = editor.getText()
    expect(afterX).toContain("X")

    // Now dispatch a slow command (background) — it will be in-flight when
    // we call undo.
    let slowCompleted = false
    const SlowOp = defineCommand({
      op: "test.slow.undo-interrupt",
      description: () => "slow",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({ done: Schema.Boolean }),
      forward: () =>
        Effect.gen(function* () {
          yield* Effect.sleep("400 millis")
          slowCompleted = true
          return { done: true }
        }),
      reverse: Reverse.skipOnUndo,
      concurrencyPolicy: "allow-concurrent",
    })

    const slowPromise = runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, SlowOp, undefined)
      }),
    ).catch(() => "interrupted")

    // Yield so the slow op starts
    await new Promise((r) => setTimeout(r, 15))

    // Now press Cmd-Z. undo() should:
    //  1. Interrupt the in-flight slow op
    //  2. Pop the prior InsertText entry
    //  3. Reverse it
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )

    // The slow op never reached its post-sleep completion
    const slowSettled = await slowPromise
    expect(slowSettled).toBe("interrupted")
    expect(slowCompleted).toBe(false)

    // The InsertText was undone — the "X" is gone
    expect(editor.getText()).not.toContain("X")
  })
})
