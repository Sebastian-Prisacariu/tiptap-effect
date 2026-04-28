import { Registry, Result } from "@effect-atom/atom"
import { Effect, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineCommand, Reverse } from "tiptap-effect/command"
import { CommandExecutor } from "tiptap-effect/command"
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

describe("CommandExecutor — editor-disposal interrupts in-flight commands", () => {
  it("interruptAllForEditor (called from the editor's scope finalizer) interrupts an in-flight Command's fiber within one tick", async () => {
    const id = EditorId("ed-disposal-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    let postSleep = false

    const SlowOp = defineCommand({
      op: "test.slow.dispose",
      description: () => "slow",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({ done: Schema.Boolean }),
      forward: () =>
        Effect.gen(function* () {
          yield* Effect.sleep("500 millis")
          postSleep = true
          return { done: true }
        }),
      reverse: Reverse.skipOnUndo,
      concurrencyPolicy: "allow-concurrent",
    })

    // Kick off in-flight dispatch (background)
    const slowPromise = runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, SlowOp, undefined)
      }),
    ).catch(() => "interrupted" as const)

    // Yield so the fiber starts
    await new Promise((r) => setTimeout(r, 20))

    // Simulate editor disposal by invoking the same hook the scope finalizer
    // calls — through the SAME editorRuntime so interruptAllForEditor sees
    // the perEditorFibers entry that the slow op registered.
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.interruptAllForEditor(editor)
      }),
    )

    // The slow op should resolve to "interrupted" within a tick — well
    // before the 500ms forward sleep would finish.
    const start = Date.now()
    const settled = await Promise.race([
      slowPromise,
      new Promise<string>((r) => setTimeout(() => r("timeout"), 200)),
    ])
    const elapsed = Date.now() - start

    expect(settled).toBe("interrupted")
    // forward never reached its post-sleep assignment
    expect(postSleep).toBe(false)
    expect(elapsed).toBeLessThan(180)

    void _keep
  })
})
