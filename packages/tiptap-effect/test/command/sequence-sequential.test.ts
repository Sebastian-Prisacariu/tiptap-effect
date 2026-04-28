import { Data, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineCommand, Reverse } from "tiptap-effect/command"
import { CommandExecutor } from "tiptap-effect/command"
import { PartialFailure, Sequence } from "tiptap-effect/command"

class StepError extends Data.TaggedError("StepError")<{
  readonly at: number
}> {}

let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor, never>

beforeEach(() => {
  runtime = ManagedRuntime.make(CommandExecutor.Default as Layer.Layer<CommandExecutor>)
})

afterEach(async () => {
  await runtime.dispose()
})

describe("Sequence.sequential", () => {
  it("happy path: runs each forward in order; outputs is a tuple", async () => {
    const log: Array<string> = []
    const stepA = defineCommand({
      op: "test.seq.a",
      description: () => "A",
      inputSchema: Schema.Void,
      outputSchema: Schema.Literal("A-out"),
      forward: () => Effect.sync(() => {
        log.push("a-fwd")
        return "A-out" as const
      }),
      reverse: () => Effect.sync(() => {
        log.push("a-rev")
      }),
    })
    const stepB = defineCommand({
      op: "test.seq.b",
      description: () => "B",
      inputSchema: Schema.Void,
      outputSchema: Schema.Literal("B-out"),
      forward: () => Effect.sync(() => {
        log.push("b-fwd")
        return "B-out" as const
      }),
      reverse: () => Effect.sync(() => {
        log.push("b-rev")
      }),
    })

    const seq = Sequence.sequential("test.seq.ab", [stepA, stepB] as const, () => "AB")

    const out = await runtime.runPromise(
      seq.forward([undefined, undefined] as never),
    )
    expect(out).toEqual(["A-out", "B-out"])
    expect(log).toEqual(["a-fwd", "b-fwd"])

    // Reverse runs each step's reverse in reverse order
    const reverseFn = seq.reverse as unknown as (
      i: never,
      o: never,
    ) => Effect.Effect<void, never, never>
    await runtime.runPromise(reverseFn([undefined, undefined] as never, out as never))
    expect(log).toEqual(["a-fwd", "b-fwd", "b-rev", "a-rev"])
  })

  it("on step-K failure: rolls back steps 0..K-1 and yields PartialFailure", async () => {
    const log: Array<string> = []
    const stepA = defineCommand({
      op: "test.fail.a",
      description: () => "A",
      inputSchema: Schema.Void,
      outputSchema: Schema.Literal("A-out"),
      forward: () => Effect.sync(() => {
        log.push("a-fwd")
        return "A-out" as const
      }),
      reverse: () => Effect.sync(() => {
        log.push("a-rev")
      }),
    })
    const stepBFailing = defineCommand<"test.fail.b", void, "B-out", StepError, never>({
      op: "test.fail.b",
      description: () => "B fails",
      inputSchema: Schema.Void,
      outputSchema: Schema.Literal("B-out"),
      forward: () => Effect.fail(new StepError({ at: 1 })),
      reverse: () => Effect.sync(() => {
        log.push("b-rev")
      }),
    })

    const seq = Sequence.sequential(
      "test.fail.ab",
      [stepA, stepBFailing] as const,
      () => "AB",
    )

    const result = await runtime.runPromise(
      Effect.either(seq.forward([undefined, undefined] as never)),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PartialFailure)
      const pf = result.left as PartialFailure
      expect(pf.props.failedAt).toBe(1)
      expect(pf.props.rolledBackThrough).toBe(0)
    }
    // a-fwd ran, b failed (no b-fwd in log), a-rev rolled back
    expect(log).toEqual(["a-fwd", "a-rev"])
  })

  it("a step with notReversible makes the whole Sequence notReversible", () => {
    const stepA = defineCommand({
      op: "x.a",
      description: () => "A",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.succeed({}),
      reverse: () => Effect.void,
    })
    const stepIrr = defineCommand({
      op: "x.b",
      description: () => "B",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.succeed({}),
      reverse: Reverse.notReversible,
    })
    const seq = Sequence.sequential("x.seq", [stepA, stepIrr] as const, () => "")
    expect(seq.reverse).toBe(Reverse.notReversible)
  })

  it("skipOnUndo steps are silently skipped in the Sequence's reverse", async () => {
    const log: Array<string> = []
    const stepA = defineCommand({
      op: "y.a",
      description: () => "A",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.sync(() => {
        log.push("a-fwd"); return {}
      }),
      reverse: () => Effect.sync(() => { log.push("a-rev") }),
    })
    const stepSkip = defineCommand({
      op: "y.skip",
      description: () => "skip",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.sync(() => {
        log.push("skip-fwd"); return {}
      }),
      reverse: Reverse.skipOnUndo,
    })
    const seq = Sequence.sequential(
      "y.seq",
      [stepA, stepSkip] as const,
      () => "",
    )
    const out = (await runtime.runPromise(
      seq.forward([undefined, undefined] as never),
    )) as ReadonlyArray<unknown>
    const reverseFn = seq.reverse as unknown as (
      i: never,
      o: never,
    ) => Effect.Effect<void, never, never>
    await runtime.runPromise(reverseFn([undefined, undefined] as never, out as never))
    expect(log).toEqual(["a-fwd", "skip-fwd", "a-rev"])
  })
})
