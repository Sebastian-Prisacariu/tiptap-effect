import type { Editor as TiptapEditor } from "@tiptap/core"
import { Context, Data, Effect, Either, Layer, Schema } from "effect"
import { type Command, CommandValidationError, NotReversibleError, Reverse } from "./command"
import { CommandHistory, type CommandRecord } from "./command-history"
import { CurrentEditor } from "./internal/current-editor"
import type { TransactionalRollbackError } from "./internal/transactional-rollback"
import { projectSelection } from "../internal/project-selection"
import type { SelectionInfo } from "../schema/selection"
import type { EditorId } from "../types"
import { getEditorId } from "../internal/editor-ids"
import { CommandErrorHandler, type CommandFailed } from "./command-error-handler"
import {
  CommandBusyError,
  makeCommandConcurrency,
} from "./internal/command-concurrency"
import { makeCommandRunTracker } from "./internal/command-run-tracker"
import { makeCommandHistoryNavigation } from "./internal/command-history-navigation"
import { withCommandOrigin } from "./internal/transaction-origin"

export { CommandBusyError } from "./internal/command-concurrency"
export type { NotReversibleAttempt } from "./internal/command-history-navigation"

/**
 * Raised when `CommandExecutor.replay(record, { strict: true })` re-runs a
 * Command and the output diverges from the stored output.
 *
 * Carries both output values for structured diffing — useful when replaying
 * agent-recorded sessions or migrating ops between code versions.
 */
export class ReplayDivergenceError extends Data.TaggedError(
  "ReplayDivergenceError",
)<{
  readonly op: string
  readonly expected: unknown
  readonly actual: unknown
}> {}

/**
 * Executes Commands with input validation, runs forward + reverse against a
 * provided editor, manages CommandHistory + the A3 (notReversible) toggle,
 * implements the four concurrency policies (block-while-pending / queue /
 * interrupt-and-replace / allow-concurrent), tracks per-editor in-flight
 * fibers for editor-disposal interrupts, supports `transactional: true`
 * automatic step-inversion rollback on failure, and surfaces two streams:
 * `notReversibleEvents` and `commandFailedEvents`.
 */
export class CommandExecutor extends Effect.Service<CommandExecutor>()(
  "tiptap-effect/CommandExecutor",
  {
    effect: Effect.gen(function* () {
      const history = yield* CommandHistory
      const errorHandler = yield* CommandErrorHandler
      const concurrency = yield* makeCommandConcurrency
      const tracker = yield* makeCommandRunTracker({ errorHandler })
      const navigation = yield* makeCommandHistoryNavigation({
        history,
        interruptAllForEditor: tracker.interruptAllForEditor,
      })

      const captureSelection = (
        editor: TiptapEditor,
        cmd: { readonly op: string; readonly capturesSelection?: boolean },
      ): Effect.Effect<SelectionInfo | null> =>
        cmd.capturesSelection
          ? Effect.try({
              try: () => projectSelection(editor.state),
              catch: (cause) => cause,
            }).pipe(
              Effect.catchAll((cause) =>
                Effect.logWarning(
                  "[tiptap-effect/commands] failed to capture selection",
                  { op: cmd.op, cause },
                ).pipe(Effect.as(null)),
              ),
            )
          : Effect.succeed(null)

      const decodeInput = <Op extends string, In>(
        cmd: { readonly op: Op; readonly inputSchema: Schema.Schema<In> },
        input: In,
      ): Effect.Effect<In, CommandValidationError> =>
        Schema.decodeUnknown(cmd.inputSchema)(input).pipe(
          Effect.mapError(
            (cause) => new CommandValidationError({ op: cmd.op, phase: "input", cause }),
          ),
        )

      const decodeOutput = <Op extends string, Out>(
        cmd: { readonly op: Op; readonly outputSchema: Schema.Schema<Out> },
        output: unknown,
      ): Effect.Effect<Out, CommandValidationError> =>
        Schema.decodeUnknown(cmd.outputSchema)(output).pipe(
          Effect.mapError(
            (cause) => new CommandValidationError({ op: cmd.op, phase: "output", cause }),
          ),
        )

      const makeRecord = <Op extends string, In, Out, Err, R>(
        editorId: EditorId,
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
        output: Out,
        selection: SelectionInfo | null,
        coalesceKey: string | undefined,
        at: number,
        env: Context.Context<Exclude<R, CurrentEditor>>,
      ): CommandRecord => {
        const forwardEffect = (target: TiptapEditor) =>
          withCommandOrigin(
            target,
            cmd.op,
            cmd.forward(input).pipe(
              Effect.provideService(CurrentEditor, target),
              Effect.flatMap((nextOutput) => decodeOutput(cmd, nextOutput)),
              Effect.provide(env),
            ),
          )

        const reverseEffect =
          typeof cmd.reverse === "function"
            ? (target: TiptapEditor, currentOutput: unknown) =>
                withCommandOrigin(
                  target,
                  cmd.op,
                  decodeOutput(cmd, currentOutput).pipe(
                    Effect.flatMap((decodedOutput) =>
                      cmd.reverse === Reverse.notReversible || cmd.reverse === Reverse.skipOnUndo
                        ? Effect.void
                        : cmd.reverse(input, decodedOutput).pipe(
                            Effect.provideService(CurrentEditor, target),
                              Effect.provide(env),
                          ),
                    ),
                  ),
                )
            : cmd.reverse

        const outputEquals = (() => {
          const equals = Schema.equivalence(cmd.outputSchema)
          return (left: unknown, right: unknown): boolean => {
            const leftDecoded = Schema.decodeUnknownEither(cmd.outputSchema)(left)
            const rightDecoded = Schema.decodeUnknownEither(cmd.outputSchema)(right)
            if (Either.isLeft(leftDecoded) || Either.isLeft(rightDecoded)) {
              return false
            }
            return equals(leftDecoded.right, rightDecoded.right)
          }
        })()

        return {
          editorId,
          op: cmd.op,
          input,
          output,
          at,
          forwardEffect,
          reverseEffect,
          selection,
          coalesceKey,
          outputEquals,
          coalesce: cmd.coalesce
            ? (prev, next) => {
                const prevInput = Schema.decodeUnknownEither(cmd.inputSchema)(prev.input)
                const prevOutput = Schema.decodeUnknownEither(cmd.outputSchema)(prev.output)
                const nextInput = Schema.decodeUnknownEither(cmd.inputSchema)(next.input)
                const nextOutput = Schema.decodeUnknownEither(cmd.outputSchema)(next.output)
                if (
                  Either.isLeft(prevInput) ||
                  Either.isLeft(prevOutput) ||
                  Either.isLeft(nextInput) ||
                  Either.isLeft(nextOutput)
                ) {
                  return null
                }
                const merged = cmd.coalesce!(
                  { input: prevInput.right, output: prevOutput.right },
                  { input: nextInput.right, output: nextOutput.right },
                )
                if (merged === null) return null
                return makeRecord(
                  editorId,
                  editor,
                  cmd,
                  merged.input,
                  merged.output,
                  selection,
                  coalesceKey,
                  Date.now(),
                  env,
                )
              }
            : undefined,
        }
      }

      const realRun = Effect.fnUntraced(function* <
        Op extends string,
        In,
        Out,
        Err,
        R,
      >(
        editorId: EditorId,
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ) {
        const validated = yield* decodeInput(cmd, input)
        return yield* withCommandOrigin(
          editor,
          cmd.op,
          Effect.gen(function* () {
            const selection = yield* captureSelection(editor, cmd)
            const rawOutput = yield* cmd.forward(validated).pipe(
              Effect.provideService(CurrentEditor, editor),
            )
            const out = yield* decodeOutput(cmd, rawOutput)
            const coalesceKey = cmd.coalesceKey ? cmd.coalesceKey(validated) : undefined
            const env = yield* Effect.context<Exclude<R, CurrentEditor>>()
            const record = makeRecord(editorId, editor, cmd, validated, out, selection, coalesceKey, Date.now(), env)
            yield* history.pushCoalesced(editorId, record)
            yield* navigation.onCommandRecorded(editorId)
            return out
          }),
        )
      })

      const tracked = <Op extends string, In, Out, Err, R>(
        editorId: EditorId,
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
        opts: { trackOp?: boolean } = {},
      ): Effect.Effect<
        Out,
        Err | CommandValidationError | TransactionalRollbackError,
        Exclude<R, CurrentEditor>
      > =>
        tracker.run({
          editorId,
          editor,
          op: cmd.op,
          transactional: cmd.transactional === true,
          trackOp: opts.trackOp === true,
          run: realRun(editorId, editor, cmd, input),
        })

      const run = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<
        Out,
        | Err
        | NotReversibleError
        | CommandBusyError
        | CommandValidationError
        | TransactionalRollbackError,
        Exclude<R, CurrentEditor>
      > => {
        const editorId = getEditorId(editor)
        const op = cmd.op
        const policy = cmd.concurrencyPolicy ?? "block-while-pending"
        return concurrency.runWithPolicy({
          editorId,
          op,
          policy,
          interruptExisting: tracker.interruptExistingOp(editorId, op),
          run: ({ trackOp }) =>
            tracked(editorId, editor, cmd, input, { trackOp }),
        }) as Effect.Effect<
          Out,
          | Err
          | NotReversibleError
          | CommandBusyError
          | CommandValidationError
          | TransactionalRollbackError,
          Exclude<R, CurrentEditor>
        >
      }

      /**
       * Re-run a stored Command record's `forwardEffect` and return its
       * output. Does NOT push a new history entry. In strict mode,
       * compares the re-run's output against the stored output via the
       * Command's `outputSchema` equivalence and yields `ReplayDivergenceError`
       * on mismatch.
       *
       * Useful for replaying agent-recorded sessions, golden-master
       * regression tests, and op-log migrations.
       */
      const replay = Effect.fnUntraced(function* (
        editor: TiptapEditor,
        record: CommandRecord,
        opts: { readonly strict?: boolean } = {},
      ) {
        const actual = yield* record.forwardEffect(editor)
        if (opts.strict !== true) return actual
        const outputEquals = record.outputEquals
        if (outputEquals === undefined) return actual
        if (!outputEquals(record.output, actual)) {
          return yield* new ReplayDivergenceError({
            op: record.op,
            expected: record.output,
            actual,
          })
        }
        return actual
      })

      const dryRun = Effect.fnUntraced(function* <
        Op extends string,
        In,
        Out,
        Err,
        R,
      >(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ) {
        const validated = yield* decodeInput(cmd, input)
        if (typeof cmd.reverse !== "function") {
          return yield* new NotReversibleError({ op: cmd.op })
        }
        return yield* withCommandOrigin(
          editor,
          cmd.op,
          Effect.gen(function* () {
            const rawOutput = yield* cmd.forward(validated).pipe(
              Effect.provideService(CurrentEditor, editor),
            )
            const out = yield* decodeOutput(cmd, rawOutput)
            if (typeof cmd.reverse === "function") {
              yield* cmd.reverse(validated, out).pipe(Effect.provideService(CurrentEditor, editor))
            }
            return out
          }),
        )
      })

      return {
        run,
        undo: navigation.undo,
        redo: navigation.redo,
        dryRun,
        replay,
        isPending: concurrency.isPending,
        pendingChanges: concurrency.pendingChanges,
        interruptAllForEditor: tracker.interruptAllForEditor,
        notReversibleEvents: navigation.notReversibleEvents,
        commandFailedEvents: errorHandler.events,
      } as const
    }),
    dependencies: [CommandHistory.Default, CommandErrorHandler.Default],
  },
) {}

export const CommandExecutorLive: Layer.Layer<CommandExecutor | CommandHistory> =
  Layer.merge(CommandExecutor.Default, CommandHistory.Default)
