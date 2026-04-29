import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Data, Effect, Schema } from "effect";
import { CurrentEditor } from "./internal/current-editor";

/**
 * Sentinel values used in a Command's `reverse` field to declare
 * irreversibility kind.
 */
export const Reverse = {
  /** Hard-irreversible. Blocks chain undo (A3 toggle). */
  notReversible: "tiptap-effect/Reverse/NotReversible" as const,
  /** Soft-irreversible. Undo silently skips past this entry. */
  skipOnUndo: "tiptap-effect/Reverse/SkipOnUndo" as const,
} as const;

export type ReverseKind = (typeof Reverse)[keyof typeof Reverse];

export class NotReversibleError extends Data.TaggedError("NotReversibleError")<{
  readonly op: string;
}> {}

export class CommandValidationError extends Data.TaggedError(
  "CommandValidationError",
)<{
  readonly op: string;
  readonly phase: "input" | "output";
  readonly cause: unknown;
}> {}

export class CommandApplicationError extends Data.TaggedError(
  "CommandApplicationError",
)<{
  readonly op: string;
  readonly phase: "forward" | "reverse";
}> {}

/**
 * Concurrency policies a Command can declare for in-flight overlap behaviour.
 * Default is `"block-while-pending"`.
 *
 * - `block-while-pending`: a duplicate dispatch (same `op`) while one is in
 *   flight fails immediately with `CommandBusyError`.
 * - `queue`: dispatches stack and run sequentially in arrival order via a
 *   per-op semaphore.
 * - `interrupt-and-replace`: the in-flight fiber for this op is interrupted,
 *   the new dispatch starts immediately.
 * - `allow-concurrent`: dispatches run in parallel (no gating). Use for
 *   read-only or idempotent commands only.
 */
export type ConcurrencyPolicy =
  | "block-while-pending"
  | "queue"
  | "interrupt-and-replace"
  | "allow-concurrent";

/**
 * A pair of (input, output) snapshots used by `coalesce` to produce a merged
 * record from two adjacent same-op records.
 */
export interface CoalescePair<In, Out> {
  readonly input: In;
  readonly output: Out;
}

export interface Command<
  Op extends string = string,
  In = unknown,
  Out = unknown,
  Err = never,
  R = never,
> {
  readonly op: Op;
  readonly description: (input: In) => string;
  readonly inputSchema: Schema.Schema<In>;
  readonly outputSchema: Schema.Schema<Out>;
  readonly forward: (input: In) => Effect.Effect<Out, Err, R>;
  readonly reverse:
    | ((input: In, output: Out) => Effect.Effect<void, Err, R>)
    | ReverseKind;
  readonly capturesSelection?: boolean;
  readonly coalesceKey?: (input: In) => string;
  /**
   * In-flight overlap policy. Default `"block-while-pending"`. See
   * `ConcurrencyPolicy`.
   */
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  /**
   * When `true`, the executor installs a dispatch wrapper on the editor that
   * tags every PM transaction dispatched while this Command is running with
   * the cmd's id and captures step inversions. On Command failure or
   * interruption, the executor replays the inversions in reverse order to
   * roll the doc back. Untagged transactions (e.g. user input dispatched
   * before or after the cmd's lifetime) are unaffected.
   */
  readonly transactional?: boolean;
  /**
   * Merge an adjacent same-op record (`prev`) with the just-dispatched
   * record (`next`). Required for coalescing to actually fold two history
   * entries into one — without it, only the *most recent* record survives the
   * window and `reverse` may be wrong.
   *
   * Return `null` to opt this specific pair out of merging (e.g. two
   * `InsertText` calls at non-adjacent positions are distinct user actions
   * and must remain separate history entries even though their `coalesceKey`
   * matches).
   */
  readonly coalesce?: (
    prev: CoalescePair<In, Out>,
    next: CoalescePair<In, Out>,
  ) => CoalescePair<In, Out> | null;
}

export type AnyCommand = Command<string, unknown, unknown, unknown, unknown>;

export type RunnableCommand<
  Op extends string = string,
  In = unknown,
  Out = unknown,
  Err = unknown,
  R = never,
> = Command<Op, In, Out, Err, R>;

export type EditorRunnableCommand<
  Op extends string = string,
  In = unknown,
  Out = unknown,
  Err = unknown,
> = Command<Op, In, Out, Err, CurrentEditor | never>;

export const defineCommand = <
  Op extends string,
  In,
  Out,
  Err = never,
  R = never,
>(
  cmd: Command<Op, In, Out, Err, R>,
): Command<Op, In, Out, Err, R> => cmd;

type Chain = ReturnType<TiptapEditor["chain"]>;

export interface EditorCommand<
  Op extends string,
  In,
  Out,
  Err = CommandApplicationError,
> extends Command<Op, In, Out, Err, CurrentEditor> {
  readonly _editorCommand: true;
  readonly apply: (chain: Chain, input: In) => Chain;
  readonly applyReverse?: (chain: Chain, input: In, captured: Out) => Chain;
  readonly reverseSetup?: (state: EditorState, input: In) => Out;
}

interface EditorCommandBaseSpec<Op extends string, In> {
  op: Op;
  description: (input: In) => string;
  inputSchema: Schema.Schema<In>;
  apply: (chain: Chain, input: In) => Chain;
  capturesSelection?: boolean;
  coalesceKey?: (input: In) => string;
  concurrencyPolicy?: ConcurrencyPolicy;
  transactional?: boolean;
}

interface ReversibleEditorCommandSpec<
  Op extends string,
  In,
  Out,
> extends EditorCommandBaseSpec<Op, In> {
  outputSchema: Schema.Schema<Out>;
  applyReverse: (chain: Chain, input: In, captured: Out) => Chain;
  reverseSetup: (state: EditorState, input: In) => Out;
  coalesce?: (
    prev: CoalescePair<In, Out>,
    next: CoalescePair<In, Out>,
  ) => CoalescePair<In, Out> | null;
}

interface IrreversibleEditorCommandSpec<
  Op extends string,
  In,
> extends EditorCommandBaseSpec<Op, In> {
  outputSchema?: Schema.Schema<void>;
  applyReverse?: never;
  reverseSetup?: never;
  coalesce?: never;
}

const isReversibleEditorSpec = <Op extends string, In, Out>(
  spec:
    | ReversibleEditorCommandSpec<Op, In, Out>
    | IrreversibleEditorCommandSpec<Op, In>,
): spec is ReversibleEditorCommandSpec<Op, In, Out> =>
  typeof spec.reverseSetup === "function" && typeof spec.applyReverse === "function";

const runChain = (
  op: string,
  phase: "forward" | "reverse",
  chain: Chain,
): Effect.Effect<void, CommandApplicationError> =>
  Effect.sync(() => chain.run()).pipe(
    Effect.flatMap((ok) =>
      ok
        ? Effect.void
        : Effect.fail(new CommandApplicationError({ op, phase })),
    ),
  );

export function defineEditorCommand<Op extends string, In, Out>(
  spec: ReversibleEditorCommandSpec<Op, In, Out>,
): EditorCommand<Op, In, Out>;
export function defineEditorCommand<Op extends string, In>(
  spec: IrreversibleEditorCommandSpec<Op, In>,
): EditorCommand<Op, In, void>;
export function defineEditorCommand<Op extends string, In, Out>(
  spec:
    | ReversibleEditorCommandSpec<Op, In, Out>
    | IrreversibleEditorCommandSpec<Op, In>,
): EditorCommand<Op, In, Out> | EditorCommand<Op, In, void> {
  if (isReversibleEditorSpec(spec)) {
    const forward = (
      input: In,
    ): Effect.Effect<Out, CommandApplicationError, CurrentEditor> =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const captured = spec.reverseSetup(editor.state, input);
        const chain = editor.chain();
        yield* runChain(spec.op, "forward", spec.apply(chain, input));
        return captured;
      });

    const reverse = (input: In, captured: Out) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        yield* runChain(
          spec.op,
          "reverse",
          spec.applyReverse(editor.chain(), input, captured),
        );
      });

    return {
      _editorCommand: true,
      op: spec.op,
      description: spec.description,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      forward,
      reverse,
      apply: spec.apply,
      applyReverse: spec.applyReverse,
      reverseSetup: spec.reverseSetup,
      capturesSelection: spec.capturesSelection,
      coalesceKey: spec.coalesceKey,
      coalesce: spec.coalesce,
      concurrencyPolicy: spec.concurrencyPolicy,
      transactional: spec.transactional,
    };
  }

  const forward = (input: In): Effect.Effect<void, CommandApplicationError, CurrentEditor> =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      yield* runChain(spec.op, "forward", spec.apply(editor.chain(), input));
    });

  return {
    _editorCommand: true,
    op: spec.op,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: Schema.Void,
    forward,
    reverse: Reverse.notReversible,
    apply: spec.apply,
    capturesSelection: spec.capturesSelection,
    coalesceKey: spec.coalesceKey,
    concurrencyPolicy: spec.concurrencyPolicy,
    transactional: spec.transactional,
  };
}
