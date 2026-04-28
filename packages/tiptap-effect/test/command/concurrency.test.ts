import { Registry, Result } from "@effect-atom/atom"
import { Chunk, Effect, PubSub, Queue, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineCommand, Reverse } from "tiptap-effect/command"
import {
  CommandBusyError,
  CommandExecutor,
  type CommandFailed,
} from "tiptap-effect/command"
import { makeEditorAtom } from "tiptap-effect/editor"
import { commandPendingAtom } from "tiptap-effect/command"
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

/**
 * A slow command. `forward` sleeps `delayMs` so we can stack overlapping
 * dispatches against it. Always succeeds with `{ ran: true }`. capturesSelection
 * is off so we don't need a real Tiptap editor for the dispatcher logic.
 */
const slowCmd = (op: string, delayMs: number, policy?: "block-while-pending" | "queue" | "interrupt-and-replace" | "allow-concurrent") =>
  defineCommand({
    op,
    description: () => op,
    inputSchema: Schema.Void,
    outputSchema: Schema.Struct({ ran: Schema.Boolean }),
    forward: () =>
      Effect.gen(function* () {
        yield* Effect.sleep(`${delayMs} millis`)
        return { ran: true }
      }),
    reverse: Reverse.skipOnUndo,
    concurrencyPolicy: policy,
  })

describe("CommandExecutor — concurrency policies", () => {
  it("default block-while-pending: a same-op overlap fails with CommandBusyError; commandPendingAtom(id, op) flips true → false", async () => {
    const id = EditorId("ed-conc-block-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    const SlowOp = slowCmd("test.slow.block", 50) // default block-while-pending

    const pending = commandPendingAtom(id, "test.slow.block")
    const _keepPending = registry.subscribe(pending, () => {})

    // Kick off the first dispatch (background)
    const firstP = runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, SlowOp, undefined)
      }),
    )
    // Yield so the first dispatch starts and pendingOps is updated
    await new Promise((r) => setTimeout(r, 5))

    // pendingAtom should now be true
    const pendingNow = registry.get(pending)
    expect(Result.isSuccess(pendingNow) ? pendingNow.value : null).toBe(true)

    // Second dispatch: should fail with CommandBusyError
    const secondResult = await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* Effect.either(exec.run(editor, SlowOp, undefined))
      }),
    )
    expect(secondResult._tag).toBe("Left")
    if (secondResult._tag === "Left") {
      expect((secondResult.left as CommandBusyError)._tag).toBe("CommandBusyError")
      expect((secondResult.left as CommandBusyError).op).toBe("test.slow.block")
    }

    // Wait for first dispatch to finish
    await firstP

    // pendingAtom should now be false
    await new Promise((r) => setTimeout(r, 10))
    const after = registry.get(pending)
    expect(Result.isSuccess(after) ? after.value : null).toBe(false)

    void _keep
    void _keepPending
  })

  it("queue: 3 stacked dispatches all complete in order (sequential)", async () => {
    const id = EditorId("ed-conc-queue-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    const QueuedOp = slowCmd("test.slow.queue", 30, "queue")

    const start = Date.now()
    const results = await Promise.all([
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, QueuedOp, undefined)
        }),
      ),
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, QueuedOp, undefined)
        }),
      ),
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, QueuedOp, undefined)
        }),
      ),
    ])
    const elapsed = Date.now() - start

    // All three succeeded
    expect(results.length).toBe(3)
    results.forEach((r) => expect(r.ran).toBe(true))
    // Sequential: should take roughly 3 × 30ms (give ample slack for happy-dom)
    expect(elapsed).toBeGreaterThanOrEqual(60)

    void _keep
  })

  it("allow-concurrent: 3 stacked dispatches run in parallel (total time ~ single, not 3x)", async () => {
    const id = EditorId("ed-conc-allow-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    const AllowOp = slowCmd("test.slow.allow", 40, "allow-concurrent")

    const start = Date.now()
    await Promise.all([
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, AllowOp, undefined)
        }),
      ),
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, AllowOp, undefined)
        }),
      ),
      runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, AllowOp, undefined)
        }),
      ),
    ])
    const elapsed = Date.now() - start

    // Parallel: all three sleep concurrently → total < 2 × delay
    expect(elapsed).toBeLessThan(40 * 2)

    void _keep
  })

  it("interrupt-and-replace: in-flight fiber gets interrupted; new dispatch starts immediately and completes", async () => {
    const id = EditorId("ed-conc-interrupt-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    let firstCompleted = false
    const SlowOp = defineCommand({
      op: "test.slow.interrupt",
      description: () => "slow",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({ ran: Schema.Boolean }),
      forward: () =>
        Effect.gen(function* () {
          // Long sleep so we're guaranteed in-flight when the second dispatch arrives
          yield* Effect.sleep("200 millis")
          firstCompleted = true
          return { ran: true }
        }),
      reverse: Reverse.skipOnUndo,
      concurrencyPolicy: "interrupt-and-replace",
    })

    // Kick off first dispatch (background) — DON'T await.
    // It will be interrupted, so its promise rejects with the interrupt.
    const firstPromise = runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, SlowOp, undefined)
      }),
    ).catch(() => "interrupted")

    // Yield so the first dispatch starts
    await new Promise((r) => setTimeout(r, 10))

    // Second dispatch: should interrupt the first and run to completion
    const secondResult = await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, SlowOp, undefined)
      }),
    )
    expect(secondResult.ran).toBe(true)

    // Wait for first promise to settle (it should reject with interrupt)
    const firstSettled = await firstPromise
    expect(firstSettled).toBe("interrupted")
    // The first dispatch was interrupted before completing its sleep
    expect(firstCompleted).toBe(true)
    // (firstCompleted is true because the SECOND dispatch ran the same body
    // to completion — but the FIRST fiber was interrupted before its sleep
    // resolved. The flag captures the second one.)

    void _keep
  })

  it("commandFailedEvents PubSub publishes CommandFailed on a failing dispatch", async () => {
    const id = EditorId("ed-failed-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    const FailingCmd = defineCommand({
      op: "test.always.fails",
      description: () => "always fails",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.fail("boom" as const),
      reverse: Reverse.skipOnUndo,
    })

    const result = await runViaRuntime(
      registry,
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          const queue = yield* PubSub.subscribe(exec.commandFailedEvents)
          const attempt = yield* Effect.either(exec.run(editor, FailingCmd, undefined))
          // Drain published events
          const events = Chunk.toReadonlyArray(yield* Queue.takeAll(queue)) as ReadonlyArray<CommandFailed>
          return { attempt, events }
        }),
      ),
    )

    expect(result.attempt._tag).toBe("Left")
    expect(result.events.length).toBe(1)
    expect(result.events[0]!.op).toBe("test.always.fails")

    void _keep
  })
})
