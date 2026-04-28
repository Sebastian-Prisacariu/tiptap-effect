import type { JSONContent } from "@tiptap/core"
import { Data, Effect, Either, Schema } from "effect"
import {
  defineCommand,
  Reverse,
  type Command,
  type EditorCommand,
  type ReverseKind,
} from "./command.js"
import { CurrentEditor } from "./current-editor.js"

export class PartialFailure extends Data.TaggedError("PartialFailure")<{
  readonly props: {
    readonly op: string
    readonly failedAt: number
    readonly rolledBackThrough: number
    readonly irreversibleAt: number | null
    readonly cause: unknown
  }
}> {}

/**
 * Raised by `Sequence.atomic` when its underlying chain returns false (a step
 * couldn't apply). The chain's accumulated mutations to `tr` would otherwise
 * have been dispatched by Tiptap regardless of step results — `Sequence.atomic`
 * rolls the doc back to its pre-chain JSON to keep the "no partial commit
 * visible" invariant.
 */
export class SequenceFailure extends Data.TaggedError("SequenceFailure")<{
  readonly props: {
    readonly op: string
  }
}> {}

/**
 * Canonical, audit-friendly serialisation of a Sequence's input. Each step is
 * represented by its `op` + the input it received, in declaration order.
 *
 * `Schema.encode(sequenceRecordSchema)({op, steps: [...]})` round-trips through
 * `Schema.decodeUnknown` so this can be persisted (CRDT op log, server audit
 * trail, version-snapshot diff) and rebuilt later.
 */
export const sequenceRecordSchema = Schema.Struct({
  op: Schema.String,
  steps: Schema.Array(
    Schema.Struct({
      op: Schema.String,
      input: Schema.Unknown,
    }),
  ),
})

export type SequenceRecord = typeof sequenceRecordSchema.Type

type Chain = Parameters<EditorCommand<string, never, never>["apply"]>[0]

type EditorCommandTuple<Steps extends ReadonlyArray<unknown>> = {
  readonly [K in keyof Steps]: Steps[K] extends EditorCommand<string, infer _In, infer _Out, infer _Err>
    ? Steps[K]
    : never
}

type StepInputs<Steps extends ReadonlyArray<unknown>> = {
  readonly [K in keyof Steps]: Steps[K] extends EditorCommand<string, infer In, infer _Out, infer _Err>
    ? In
    : never
}

type StepOutputs<Steps extends ReadonlyArray<unknown>> = {
  readonly [K in keyof Steps]: Steps[K] extends EditorCommand<string, infer _In, infer Out, infer _Err>
    ? Out
    : never
}

interface ErasedEditorCommand {
  readonly op: string
  readonly inputSchema: Schema.Schema<unknown>
  readonly outputSchema: Schema.Schema<unknown>
  readonly reverseSetup?: (state: unknown, input: unknown) => unknown
  readonly apply: (chain: Chain, input: unknown) => Chain
  readonly applyReverse?: (chain: Chain, input: unknown, captured: unknown) => Chain
}

const eraseEditorCommand = (step: unknown): ErasedEditorCommand =>
  step as ErasedEditorCommand

const tupleInputSchema = <Steps extends ReadonlyArray<unknown>>(
  steps: Steps,
): Schema.Schema<StepInputs<Steps>> =>
  Schema.Tuple(...steps.map((step) => eraseEditorCommand(step).inputSchema)) as unknown as Schema.Schema<StepInputs<Steps>>

const tupleOutputSchema = <Steps extends ReadonlyArray<unknown>>(
  steps: Steps,
): Schema.Schema<StepOutputs<Steps>> =>
  Schema.Tuple(...steps.map((step) => eraseEditorCommand(step).outputSchema)) as unknown as Schema.Schema<StepOutputs<Steps>>

const tupleAt = <Tuple extends ReadonlyArray<unknown>>(
  tuple: Tuple,
  index: number,
): Tuple[number] => tuple[index] as Tuple[number]

/**
 * A Sequence Command produced by `Sequence.atomic` or `Sequence.sequential`.
 * Extends `Command` with `toRecord(inputs)` so the input tuple can be
 * projected to the canonical `{op, steps}` audit shape on demand.
 */
export interface SequenceCommand<Op extends string, In, Out, Err, R>
  extends Command<Op, In, Out, Err, R> {
  readonly _sequence: true
  readonly stepOps: ReadonlyArray<string>
  readonly toRecord: (inputs: In) => SequenceRecord
}

/**
 * Run multiple `EditorCommand`s as ONE ProseMirror transaction. Either every
 * step lands or none does. One history entry; one Cmd-Z reverts the lot.
 *
 * Type-level constraint: only `EditorCommand`s (built via `defineEditorCommand`)
 * are accepted, because we need their `apply` chain ops to fuse into a single
 * transaction. General `defineCommand`s belong in `Sequence.sequential`.
 */
const atomic = <
  const Steps extends ReadonlyArray<unknown>,
  Op extends string,
>(
  op: Op,
  steps: Steps & EditorCommandTuple<Steps>,
  description: (inputs: StepInputs<Steps>) => string,
): SequenceCommand<
  Op,
  StepInputs<Steps>,
  StepOutputs<Steps>,
  SequenceFailure,
  CurrentEditor
> => {
  const inputSchema = tupleInputSchema(steps)
  const outputSchema = tupleOutputSchema(steps)

  const cmd = defineCommand<Op, StepInputs<Steps>, StepOutputs<Steps>, SequenceFailure, CurrentEditor>({
    op,
    description,
    inputSchema,
    outputSchema,
    forward: (inputs) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor
        const stateBefore = editor.state
        // Snapshot the pre-chain doc so we can restore on chain failure.
        // Tiptap's chain.run() dispatches the accumulated transaction
        // regardless of step results — we need an explicit rollback to keep
        // Sequence.atomic's "no partial commit visible" guarantee.
        const docBefore: JSONContent = stateBefore.doc.toJSON()
        const captured: Array<unknown> = []
        let chain = editor.chain()
        for (let i = 0; i < steps.length; i++) {
          const step = eraseEditorCommand(steps[i]!)
          const input = tupleAt(inputs, i)
          const cap = step.reverseSetup
            ? step.reverseSetup(stateBefore, input)
            : undefined
          captured.push(cap)
          chain = step.apply(chain, input)
        }
        const ok = chain.run()
        if (!ok) {
          // setContent signature varies across Tiptap versions — use the
          // single-arg form which always replaces the doc.
          editor.chain().setContent(docBefore).run()
          return yield* Effect.fail(new SequenceFailure({ props: { op } }))
        }
        return captured as unknown as StepOutputs<Steps>
      }),
    reverse: (inputs, captured) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor
        let chain = editor.chain()
        // Reverse in reverse order
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = eraseEditorCommand(steps[i]!)
          if (!step.applyReverse) continue
          const input = tupleAt(inputs, i)
          const cap = tupleAt(captured, i)
          chain = step.applyReverse(chain, input, cap)
        }
        chain.run()
      }),
  })

  const stepOps: ReadonlyArray<string> = steps.map((s) => eraseEditorCommand(s).op)
  return {
    ...cmd,
    _sequence: true,
    stepOps,
    toRecord: (inputs) => ({
      op,
      steps: stepOps.map((sop, i) => ({
        op: sop,
        input: tupleAt(inputs, i),
      })),
    }),
  }
}

type CommandTuple<Steps extends ReadonlyArray<unknown>> = {
  readonly [K in keyof Steps]: Steps[K] extends Command<string, infer _In, infer _Out, infer _Err, infer _R>
    ? Steps[K]
    : never
}

type AnyStepInputs<Steps extends ReadonlyArray<unknown>> = {
  readonly [K in keyof Steps]: Steps[K] extends Command<string, infer In, infer _Out, infer _Err, infer _R>
    ? In
    : never
}

type AnyStepOutputs<Steps extends ReadonlyArray<unknown>> = {
  readonly [K in keyof Steps]: Steps[K] extends Command<string, infer _In, infer Out, infer _Err, infer _R>
    ? Out
    : never
}

type AnyStepErrors<Steps extends ReadonlyArray<unknown>> = {
  [K in keyof Steps]: Steps[K] extends Command<string, infer _In, infer _Out, infer E, infer _R> ? E : never
}[number]

type AnyStepDeps<Steps extends ReadonlyArray<unknown>> = {
  [K in keyof Steps]: Steps[K] extends Command<string, infer _In, infer _Out, infer _Err, infer R> ? R : never
}[number]

interface ErasedCommand {
  readonly op: string
  readonly inputSchema: Schema.Schema<unknown>
  readonly outputSchema: Schema.Schema<unknown>
  readonly forward: (input: unknown) => Effect.Effect<unknown, unknown, unknown>
  readonly reverse:
    | ReverseKind
    | ((input: unknown, output: unknown) => Effect.Effect<void, unknown, unknown>)
}

const eraseCommand = (step: unknown): ErasedCommand => step as ErasedCommand

/**
 * Run multiple Commands sequentially. On failure of step K, runs reverses for
 * steps 0..K-1 in reverse order. Yields `PartialFailure` describing the
 * failure point and how far rollback succeeded.
 *
 * Reversibility composition:
 *   - Any step with `Reverse.notReversible` makes the whole Sequence
 *     `notReversible` (A3 toggle behaviour at the executor level).
 *   - `Reverse.skipOnUndo` steps' reverses are skipped silently in the
 *     Sequence's own reverse; the Sequence is still reversible if every
 *     non-skip step has a function reverse.
 */
const sequential = <
  const Steps extends ReadonlyArray<unknown>,
  Op extends string,
>(
  op: Op,
  steps: Steps & CommandTuple<Steps>,
  description: (inputs: AnyStepInputs<Steps>) => string,
): SequenceCommand<
  Op,
  AnyStepInputs<Steps>,
  AnyStepOutputs<Steps>,
  AnyStepErrors<Steps> | PartialFailure,
  AnyStepDeps<Steps>
> => {
  const inputSchema = Schema.Tuple(
    ...steps.map((s) => eraseCommand(s).inputSchema),
  ) as unknown as Schema.Schema<AnyStepInputs<Steps>>
  const outputSchema = Schema.Tuple(
    ...steps.map((s) => eraseCommand(s).outputSchema),
  ) as unknown as Schema.Schema<AnyStepOutputs<Steps>>

  const hasIrreversibleBlocking = steps.some(
    (s) => eraseCommand(s).reverse === Reverse.notReversible,
  )

  const forward = (inputs: AnyStepInputs<Steps>) =>
    Effect.gen(function* () {
      const outputs: Array<unknown> = []
      for (let i = 0; i < steps.length; i++) {
        const step = eraseCommand(steps[i]!)
        const input = tupleAt(inputs, i)
        const result = yield* Effect.either(step.forward(input))
        if (Either.isRight(result)) {
          outputs.push(result.right)
          continue
        }
        // Rollback successful steps in reverse order
        let irreversibleAt: number | null = null
        for (let j = i - 1; j >= 0; j--) {
          const prev = eraseCommand(steps[j]!)
          const prevInput = tupleAt(inputs, j)
          const prevOut = outputs[j]
          const rev = prev.reverse
          if (typeof rev !== "function") {
            // notReversible or skipOnUndo: cannot mechanically reverse
            if (rev === Reverse.notReversible && irreversibleAt === null) {
              irreversibleAt = j
            }
            continue
          }
          yield* Effect.either(rev(prevInput, prevOut))
        }
        return yield* Effect.fail(
          new PartialFailure({
            props: {
              op,
              failedAt: i,
              rolledBackThrough: i - 1,
              irreversibleAt,
              cause: result.left,
            },
          }),
        )
      }
      return outputs as unknown as AnyStepOutputs<Steps>
    })

  const reverse: Command<
    Op,
    AnyStepInputs<Steps>,
    AnyStepOutputs<Steps>,
    AnyStepErrors<Steps> | PartialFailure,
    AnyStepDeps<Steps>
  >["reverse"] = hasIrreversibleBlocking
    ? Reverse.notReversible
    : (((inputs: AnyStepInputs<Steps>, outputs: AnyStepOutputs<Steps>) =>
        Effect.gen(function* () {
          // Reverse in reverse order; skip skipOnUndo silently
          for (let i = steps.length - 1; i >= 0; i--) {
            const step = eraseCommand(steps[i]!)
            const rev = step.reverse
            if (rev === Reverse.skipOnUndo) continue
            if (typeof rev !== "function") continue
            const input = tupleAt(inputs, i)
            const out = tupleAt(outputs, i)
            yield* rev(input, out)
          }
        })) as unknown as Command<
          Op,
          AnyStepInputs<Steps>,
          AnyStepOutputs<Steps>,
          AnyStepErrors<Steps> | PartialFailure,
          AnyStepDeps<Steps>
        >["reverse"])

  const cmd = defineCommand<
    Op,
    AnyStepInputs<Steps>,
    AnyStepOutputs<Steps>,
    AnyStepErrors<Steps> | PartialFailure,
    AnyStepDeps<Steps>
  >({
    op,
    description,
    inputSchema,
    outputSchema,
    forward: forward as (
      input: AnyStepInputs<Steps>,
    ) => Effect.Effect<
      AnyStepOutputs<Steps>,
      AnyStepErrors<Steps> | PartialFailure,
      AnyStepDeps<Steps>
    >,
    reverse,
  })

  const stepOps: ReadonlyArray<string> = steps.map((s) => eraseCommand(s).op)
  return {
    ...cmd,
    _sequence: true,
    stepOps,
    toRecord: (inputs) => ({
      op,
      steps: stepOps.map((sop, i) => ({
        op: sop,
        input: tupleAt(inputs, i),
      })),
    }),
  }
}

export const Sequence = {
  atomic,
  sequential,
  recordSchema: sequenceRecordSchema,
}
