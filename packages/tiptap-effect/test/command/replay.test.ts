import { Registry, Result } from "@effect-atom/atom"
import { Effect, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CommandExecutor,
  CommandHistory,
  defineCommand,
  ReplayDivergenceError,
} from "tiptap-effect/command"
import type { CommandRecord } from "tiptap-effect/command"
import { ToggleMarkCommand } from "tiptap-effect/command/commands"
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
  effect: Effect.Effect<A, E, CommandExecutor | CommandHistory>,
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

const ToggleBold = ToggleMarkCommand("bold")

describe("CommandExecutor.replay", () => {
  it("non-strict replay returns the actual output and does not push a new history entry", async () => {
    const id = EditorId("ed-replay-1")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection({ from: 1, to: 4 })

    let recordedRecord: CommandRecord | null = null
    let pastBeforeReplay: ReadonlyArray<CommandRecord> = []

    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, ToggleBold, undefined)
      }),
    )

    // Capture the just-recorded entry plus history snapshot
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const history = yield* CommandHistory
        const list = yield* history.list(id)
        recordedRecord = list[list.length - 1] ?? null
        pastBeforeReplay = list
      }),
    )
    expect(recordedRecord).not.toBeNull()

    // Replay non-strict — re-runs forward but does NOT push a new entry.
    const out = await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.replay(editor, recordedRecord!)
      }),
    )
    expect(out).toBeDefined()

    // History length unchanged.
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const history = yield* CommandHistory
        const after = yield* history.list(id)
        expect(after.length).toBe(pastBeforeReplay.length)
      }),
    )
    void _keep
  })

  it("strict replay succeeds when the encoded output matches", async () => {
    // Use a deterministic Command whose output is stable: forward returns
    // a fixed { value: 42 } regardless of editor state.
    const Stable = defineCommand({
      op: "test.stable",
      description: () => "stable",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({ value: Schema.Number }),
      forward: () => Effect.succeed({ value: 42 }),
      reverse: () => Effect.void,
    })

    const id = EditorId("ed-replay-2")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    let record: CommandRecord | null = null
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, Stable, undefined)
        const history = yield* CommandHistory
        const list = yield* history.list(id)
        record = list[list.length - 1] ?? null
      }),
    )
    expect(record).not.toBeNull()

    // Strict replay — outputs match.
    const out = await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.replay(editor, record!, { strict: true })
      }),
    )
    expect(out).toEqual({ value: 42 })
    void _keep
  })

  it("strict replay fails with ReplayDivergenceError when the re-run output differs", async () => {
    // Counter-based command: output depends on call count, so re-running
    // produces a different value.
    let callCount = 0
    const Counter = defineCommand({
      op: "test.counter",
      description: () => "counter",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({ count: Schema.Number }),
      forward: () => Effect.sync(() => ({ count: ++callCount })),
      reverse: () => Effect.void,
    })

    const id = EditorId("ed-replay-3")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    let record: CommandRecord | null = null
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, Counter, undefined)
        const history = yield* CommandHistory
        const list = yield* history.list(id)
        record = list[list.length - 1] ?? null
      }),
    )

    // Strict replay — re-runs forward (callCount becomes 2), encoded
    // output { count: 2 } diverges from stored { count: 1 }.
    let caught: unknown = null
    try {
      await runViaRuntime(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.replay(editor, record!, { strict: true })
        }),
      )
    } catch (cause) {
      caught = cause
    }
    expect(caught).not.toBeNull()
    // The cause from runOneShotResult is a Cause; assert the divergence
    // error is in the failure chain by string-matching the op.
    expect(JSON.stringify(caught)).toContain("ReplayDivergenceError")
    void _keep
  })

  it("ReplayDivergenceError carries op + expected + actual outputs", () => {
    const err = new ReplayDivergenceError({
      op: "test.example",
      expected: { count: 1 },
      actual: { count: 2 },
    })
    expect(err._tag).toBe("ReplayDivergenceError")
    expect(err.op).toBe("test.example")
    expect(err.expected).toEqual({ count: 1 })
    expect(err.actual).toEqual({ count: 2 })
  })
})
