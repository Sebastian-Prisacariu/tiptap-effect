import { Registry, Result } from "@effect-atom/atom"
import { Effect, Either, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CommandExecutor,
  defineCommand,
  Reverse,
} from "tiptap-effect/command"
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
): Promise<Result.Result<A, E>> => {
  const oneShot = editorRuntime.atom(effect)
  return new Promise<Result.Result<A, E>>((resolve) => {
    const tryResolve = (r: Result.Result<A, E>) => {
      if (Result.isSuccess(r) || Result.isFailure(r)) {
        unsub()
        resolve(r)
        return true
      }
      return false
    }
    const unsub = reg.subscribe(oneShot, tryResolve)
    if (tryResolve(reg.get(oneShot))) return
  })
}

describe("transactional commands", () => {
  it("serializes transactional commands per editor even when concurrencyPolicy allows overlap", async () => {
    let inflight = 0
    let maxInflight = 0
    let totalRuns = 0

    const Transactional = defineCommand({
      op: "test.tx.serialized",
      description: (value: number) => `serialized ${value}`,
      inputSchema: Schema.Number,
      outputSchema: Schema.Number,
      forward: (value: number) =>
        Effect.gen(function* () {
          inflight += 1
          totalRuns += 1
          maxInflight = Math.max(maxInflight, inflight)
          yield* Effect.sleep("25 millis")
          inflight -= 1
          return value
        }),
      reverse: Reverse.notReversible,
      transactional: true,
      concurrencyPolicy: "allow-concurrent",
    })

    const id = EditorId("ed-tx-overlap-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))

    const result = await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* Effect.all(
          [1, 2, 3].map((value) =>
            Effect.either(exec.run(editor, Transactional, value)),
          ),
          { concurrency: "unbounded" },
        )
      }),
    )

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value.every(Either.isRight)).toBe(true)
    }
    expect(totalRuns).toBe(3)
    expect(maxInflight).toBe(1)
    void _keep
  })
})
