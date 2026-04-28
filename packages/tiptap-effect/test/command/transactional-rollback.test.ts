import { Registry, Result } from "@effect-atom/atom"
import { Effect, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineCommand, Reverse } from "../../src/command"
import { CommandExecutor } from "../../src/command-executor"
import { CurrentEditor } from "../../src/current-editor"
import { makeEditorAtom } from "../../src/editor"
import { editorRuntime } from "../../src/runtime"
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

describe("CommandExecutor — transactional: true rollback", () => {
  it("a transactional cmd that mutates the doc then fails has its tagged transactions reverted; pre-cmd untagged transactions are preserved", async () => {
    const id = EditorId("ed-tx-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))

    // Step 1: Untagged user-input dispatch BEFORE the transactional cmd —
    // this should be PRESERVED through the rollback.
    editor.commands.setTextSelection(1)
    editor.chain().focus().insertContent("U").run()
    expect(editor.getText()).toContain("U")
    const afterPreCmdText = editor.getText()

    // Step 2: A transactional cmd that mutates the doc (via chain.run inside
    // forward) and then fails.
    const TransactionalCmd = defineCommand({
      op: "test.tx.fails",
      description: () => "transactional + fails",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () =>
        Effect.gen(function* () {
          const ed = yield* CurrentEditor
          // Mutate via chain.run() — these dispatches go through the wrapper
          // which captures step inversions.
          ed.chain().focus().insertContent("T1").run()
          ed.chain().focus().insertContent("T2").run()
          // Now fail — executor should replay inversions to roll back
          // BOTH inserts (but NOT the pre-cmd "U" insert).
          return yield* Effect.fail("intentional" as const)
        }),
      reverse: Reverse.skipOnUndo,
      transactional: true,
    })

    const result = await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* Effect.either(exec.run(editor, TransactionalCmd, undefined))
      }),
    )

    expect(result._tag).toBe("Left")

    // After rollback: the "T1" + "T2" inserts are reverted, but the pre-cmd
    // "U" is preserved.
    expect(editor.getText()).not.toContain("T1")
    expect(editor.getText()).not.toContain("T2")
    expect(editor.getText()).toBe(afterPreCmdText)
    expect(editor.getText()).toContain("U")

    void _keep
  })
})
