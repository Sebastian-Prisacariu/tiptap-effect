import { Registry, Result } from "@effect-atom/atom"
import { Effect, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CommandBusyError,
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

describe("concurrency races", () => {
  it("block-while-pending: two concurrent dispatches reserve atomically — exactly one succeeds, the other fails CommandBusyError", async () => {
    let started = 0
    const Slow = defineCommand({
      op: "test.slow.block",
      description: () => "slow",
      inputSchema: Schema.Void,
      outputSchema: Schema.Number,
      forward: () =>
        Effect.gen(function* () {
          started += 1
          yield* Effect.sleep("50 millis")
          return 1
        }),
      reverse: Reverse.notReversible,
    })

    const id = EditorId("ed-races-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    // Fire both dispatches truly in parallel.
    const [a, b] = await Promise.all([
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, Slow, undefined)
        }),
      ),
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, Slow, undefined)
        }),
      ),
    ])

    const successes = [a, b].filter(Result.isSuccess).length
    const failures = [a, b].filter(Result.isFailure).length
    expect(successes).toBe(1)
    expect(failures).toBe(1)
    // The atomic check-and-mark guarantees only the winning dispatch
    // runs forward — the loser fails with CommandBusyError before
    // entering forward.
    expect(started).toBe(1)
    void _keep
  })

  it("queue: two concurrent same-op dispatches share ONE semaphore (run sequentially, both complete)", async () => {
    let inflight = 0
    let maxInflight = 0
    let totalRuns = 0
    const Queued = defineCommand({
      op: "test.slow.queue",
      description: () => "queued",
      inputSchema: Schema.Void,
      outputSchema: Schema.Number,
      forward: () =>
        Effect.gen(function* () {
          inflight += 1
          totalRuns += 1
          maxInflight = Math.max(maxInflight, inflight)
          yield* Effect.sleep("30 millis")
          inflight -= 1
          return totalRuns
        }),
      reverse: Reverse.notReversible,
      concurrencyPolicy: "queue",
    })

    const id = EditorId("ed-races-2")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    const dispatches = await Promise.all(
      [0, 1, 2, 3].map(() =>
        runViaRuntime(
          registry,
          Effect.gen(function* () {
            const exec = yield* CommandExecutor
            return yield* exec.run(editor, Queued, undefined)
          }),
        ),
      ),
    )

    expect(dispatches.every(Result.isSuccess)).toBe(true)
    // Single shared semaphore → at most one in flight at any moment.
    expect(maxInflight).toBe(1)
    expect(totalRuns).toBe(4)
    void _keep
  })

  it("CommandBusyError shape: tagged class with op string", () => {
    const err = new CommandBusyError({ op: "test.example" })
    expect(err._tag).toBe("CommandBusyError")
    expect(err.op).toBe("test.example")
  })
})
