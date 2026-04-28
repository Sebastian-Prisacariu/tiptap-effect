import type { Editor as TiptapEditor } from "@tiptap/core"
import { Context, Data, Effect, Either, Fiber, Layer, PubSub, Ref, Schema, Stream, SubscriptionRef } from "effect"
import type { Step } from "@tiptap/pm/transform"
import { type Command, CommandValidationError, NotReversibleError, Reverse } from "./command"
import { CommandHistory, type CommandRecord, getReverseFn, reverseKind } from "./command-history"
import { CurrentEditor } from "./internal/current-editor"
import { projectSelection } from "./internal/project-selection"
import {
  clearContext,
  installDispatchWrapper,
  replayInversions,
  setContext,
} from "./internal/transactional-rollback"
import type { SelectionInfo } from "../schema/selection"
import type { EditorId } from "../types"
import { getEditorId } from "../internal/editor-ids"

/**
 * Event emitted on the first Cmd-Z against a Reverse.notReversible entry.
 */
export interface NotReversibleAttempt {
  readonly editorId: EditorId
  readonly op: string
  readonly at: number
}

/**
 * Raised when a Command with `concurrencyPolicy: "block-while-pending"` (the
 * default) is dispatched while a same-op command is already in flight.
 */
export class CommandBusyError extends Data.TaggedError("CommandBusyError")<{
  readonly op: string
}> {}

/**
 * Event published on the `commandFailedEvents` PubSub for every Command that
 * fails (any policy). Interruptions do NOT publish this event — only true
 * failures.
 */
export interface CommandFailed {
  readonly editorId: EditorId
  readonly op: string
  readonly cause: unknown
  readonly at: number
}

const A3_TOGGLE_WINDOW_MS = 3000

let cmdIdCounter = 0
const nextCmdId = (op: string): string => `${op}-${Date.now()}-${cmdIdCounter++}`
const commandKey = (editorId: EditorId, op: string): string => `${editorId}\u0000${op}`

type A3State = { readonly op: string; readonly at: number }

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
      const a3State = yield* Ref.make<ReadonlyMap<EditorId, A3State>>(new Map())
      const notReversibleEvents = yield* PubSub.unbounded<NotReversibleAttempt>()
      const commandFailedEvents = yield* PubSub.unbounded<CommandFailed>()
      const pendingOps = yield* SubscriptionRef.make<ReadonlyMap<EditorId, ReadonlySet<string>>>(new Map())
      const emptyPendingOps: ReadonlySet<string> = new Set()
      const perOpFibers = new Map<string, Fiber.RuntimeFiber<unknown, unknown>>()
      const perOpSemaphores = new Map<string, Effect.Semaphore>()
      // WeakMap: per-editor live fiber set, used by editor-disposal to
      // interrupt all in-flight Commands for the editor.
      const perEditorFibers = new WeakMap<
        TiptapEditor,
        Set<Fiber.RuntimeFiber<unknown, unknown>>
      >()

      const captureSelection = (
        editor: TiptapEditor,
        cmd: { readonly capturesSelection?: boolean },
      ): SelectionInfo | null => {
        if (!cmd.capturesSelection) return null
        try {
          return projectSelection(editor.state)
        } catch {
          return null
        }
      }

      const restoreSelection = (
        editor: TiptapEditor,
        sel: SelectionInfo | null | undefined,
      ): void => {
        if (!sel) return
        if (sel.kind === "text" || sel.kind === "all") {
          editor.commands.setTextSelection({ from: sel.from, to: sel.to })
        } else if (sel.kind === "node") {
          editor.commands.setNodeSelection(sel.pos)
        }
      }

      const markPending = (editorId: EditorId, op: string) =>
        SubscriptionRef.update(pendingOps, (all) => {
          const next = new Map(all)
          const ops = new Set(next.get(editorId) ?? [])
          ops.add(op)
          next.set(editorId, ops)
          return next
        })

      const unmarkPending = (editorId: EditorId, op: string) =>
        SubscriptionRef.update(pendingOps, (all) => {
          const current = all.get(editorId)
          if (!current?.has(op)) return all
          const next = new Map(all)
          const ops = new Set(current)
          ops.delete(op)
          if (ops.size === 0) next.delete(editorId)
          else next.set(editorId, ops)
          return next
        })

      const getOrCreateSemaphore = (key: string): Effect.Effect<Effect.Semaphore> =>
        Effect.gen(function* () {
          let sem = perOpSemaphores.get(key)
          if (!sem) {
            sem = yield* Effect.makeSemaphore(1)
            perOpSemaphores.set(key, sem)
          }
          return sem
        })

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
          cmd.forward(input).pipe(
            Effect.provideService(CurrentEditor, target),
            Effect.flatMap((nextOutput) => decodeOutput(cmd, nextOutput)),
            Effect.provide(env),
          )

        const reverseEffect =
          typeof cmd.reverse === "function"
            ? (target: TiptapEditor, currentOutput: unknown) =>
                decodeOutput(cmd, currentOutput).pipe(
                  Effect.flatMap((decodedOutput) =>
                    cmd.reverse === Reverse.notReversible || cmd.reverse === Reverse.skipOnUndo
                      ? Effect.void
                      : cmd.reverse(input, decodedOutput).pipe(
                          Effect.provideService(CurrentEditor, target),
                            Effect.provide(env),
                        ),
                  ),
                )
            : cmd.reverse

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

      const realRun = <Op extends string, In, Out, Err, R>(
        editorId: EditorId,
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<Out, Err | CommandValidationError, Exclude<R, CurrentEditor>> =>
        Effect.gen(function* () {
          const validated = yield* decodeInput(cmd, input)
          const selection = captureSelection(editor, cmd)
          const rawOutput = yield* cmd.forward(validated).pipe(
            Effect.provideService(CurrentEditor, editor),
          )
          const out = yield* decodeOutput(cmd, rawOutput)
          const coalesceKey = cmd.coalesceKey ? cmd.coalesceKey(validated) : undefined
          const env = yield* Effect.context<Exclude<R, CurrentEditor>>()
          const record = makeRecord(editorId, editor, cmd, validated, out, selection, coalesceKey, Date.now(), env)
          yield* history.pushCoalesced(editorId, record)
          yield* Ref.update(a3State, (all) => {
            if (!all.has(editorId)) return all
            const next = new Map(all)
            next.delete(editorId)
            return next
          })
          return out
        })

      /**
       * Wrap `realRun` with: pendingOps tracking, commandFailedEvents
       * publication on failure (not on interrupt), per-editor fiber
       * registration (for editor-disposal interrupt), optional per-op fiber
       * registration (for interrupt-and-replace), and optional transactional
       * rollback (for `cmd.transactional`).
       */
      const tracked = <Op extends string, In, Out, Err, R>(
        editorId: EditorId,
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
        opts: { trackOp?: boolean } = {},
      ): Effect.Effect<Out, Err | CommandValidationError, Exclude<R, CurrentEditor>> =>
        (Effect.gen(function* () {
          const op = cmd.op
          const isTransactional = !!(cmd as { transactional?: boolean }).transactional
          const cmdId = nextCmdId(op)
          // inversions array shared with the dispatch wrapper (mutable)
          const inversions: Array<Step> = []

          if (isTransactional) {
            installDispatchWrapper(editor)
            setContext(editor, { cmdId, inversions })
          }

          yield* markPending(editorId, op)

          const inner = realRun(editorId, editor, cmd, input).pipe(
            Effect.tapErrorCause((cause) =>
              PubSub.publish(commandFailedEvents, {
                editorId,
                op,
                cause,
                at: Date.now(),
              }),
            ),
          )

          const fiber = yield* Effect.fork(inner)
          // Register per-editor for disposal-time interrupt
          let editorSet = perEditorFibers.get(editor)
          if (!editorSet) {
            editorSet = new Set()
            perEditorFibers.set(editor, editorSet)
          }
          const erased: Fiber.RuntimeFiber<unknown, unknown> = fiber
          editorSet.add(erased)
          const key = commandKey(editorId, op)
          if (opts.trackOp) perOpFibers.set(key, erased)

          return yield* Fiber.join(fiber).pipe(
            Effect.tapErrorCause(() =>
              Effect.sync(() => {
                if (isTransactional && inversions.length > 0) {
                  replayInversions(editor, inversions)
                }
              }),
            ),
            Effect.ensuring(
              Effect.gen(function* () {
                editorSet!.delete(erased)
                if (editorSet!.size === 0) perEditorFibers.delete(editor)
                if (opts.trackOp && perOpFibers.get(key) === erased) {
                  perOpFibers.delete(key)
                }
                if (isTransactional) clearContext(editor)
                yield* unmarkPending(editorId, op)
              }),
            ),
          )
        }))

      const run = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<Out, Err | NotReversibleError | CommandBusyError | CommandValidationError, Exclude<R, CurrentEditor>> => {
        const editorId = getEditorId(editor)
        const op = cmd.op
        const policy = cmd.concurrencyPolicy ?? "block-while-pending"
        const key = commandKey(editorId, op)

        switch (policy) {
          case "block-while-pending": {
            return Effect.gen(function* () {
              const all = yield* SubscriptionRef.get(pendingOps)
              const set = all.get(editorId) ?? emptyPendingOps
              if (set.has(op)) {
                return yield* Effect.fail(new CommandBusyError({ op }))
              }
              return yield* tracked(editorId, editor, cmd, input)
            }) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError | CommandValidationError,
              Exclude<R, CurrentEditor>
            >
          }
          case "queue": {
            return Effect.gen(function* () {
              const sem = yield* getOrCreateSemaphore(key)
              return yield* sem.withPermits(1)(tracked(editorId, editor, cmd, input))
            }) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError | CommandValidationError,
              Exclude<R, CurrentEditor>
            >
          }
          case "interrupt-and-replace": {
            return Effect.gen(function* () {
              const existing = perOpFibers.get(key)
              if (existing) {
                yield* Fiber.interrupt(existing)
                perOpFibers.delete(key)
              }
              return yield* tracked(editorId, editor, cmd, input, { trackOp: true })
            }) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError | CommandValidationError,
              Exclude<R, CurrentEditor>
            >
          }
          case "allow-concurrent": {
            return tracked(editorId, editor, cmd, input) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError | CommandValidationError,
              Exclude<R, CurrentEditor>
            >
          }
        }
      }

      /**
       * Interrupt every in-flight Command for `editor` (any concurrencyPolicy).
       * Used by editor disposal — and by `undo` to interrupt the in-flight
       * fiber before popping the prior history entry.
       *
       * Uses `Fiber.interruptFork` (fire-and-forget) rather than the awaiting
       * `Fiber.interrupt` so the caller doesn't block on each fiber's
       * interruption-cleanup chain. The per-fiber `Effect.ensuring` in
       * `tracked()` cleans up registries asynchronously.
       */
      const interruptAllForEditor = (editor: TiptapEditor): Effect.Effect<void> =>
        Effect.gen(function* () {
          const set = perEditorFibers.get(editor)
          if (!set || set.size === 0) return
          const fibers = Array.from(set)
          yield* Effect.forEach(fibers, (f) => Fiber.interruptFork(f), {
            concurrency: "unbounded",
            discard: true,
          })
        })

      const undo = (
        editor: TiptapEditor,
      ): Effect.Effect<CommandRecord | null, unknown> =>
        Effect.gen(function* () {
          const editorId = getEditorId(editor)
          // Cmd-Z while a Command is in-flight: interrupt the in-flight
          // fiber(s) first. If the cmd was `transactional: true`, its
          // interrupt path already replayed the step inversions.
          yield* interruptAllForEditor(editor)
          const last = yield* history.popLast(editorId)
          if (!last) return null
          const kind = reverseKind(last.reverseEffect)
          if (kind === Reverse.skipOnUndo) {
            return yield* undo(editor)
          }
          if (kind === Reverse.notReversible) {
            const now = Date.now()
            const prev = (yield* Ref.get(a3State)).get(editorId) ?? null
            const armed =
              prev !== null && prev.op === last.op && now - prev.at <= A3_TOGGLE_WINDOW_MS
            if (armed) {
              yield* Ref.update(a3State, (all) => {
                const next = new Map(all)
                next.delete(editorId)
                return next
              })
              return yield* undo(editor)
            }
            yield* history.push(editorId, last)
            yield* Ref.update(a3State, (all) => {
              const next = new Map(all)
              next.set(editorId, { op: last.op, at: now })
              return next
            })
            yield* PubSub.publish(notReversibleEvents, { editorId, op: last.op, at: now })
            return yield* Effect.fail(new NotReversibleError({ op: last.op }))
          }
          restoreSelection(editor, last.selection)
          const reverseFn = getReverseFn(last.reverseEffect)
          if (reverseFn) {
            yield* reverseFn(editor, last.output)
          }
          yield* history.pushFuture(editorId, last)
          yield* Ref.update(a3State, (all) => {
            if (!all.has(editorId)) return all
            const next = new Map(all)
            next.delete(editorId)
            return next
          })
          return last
        })

      const redo = (
        editor: TiptapEditor,
      ): Effect.Effect<CommandRecord | null, unknown> =>
        Effect.gen(function* () {
          const editorId = getEditorId(editor)
          const next = yield* history.popFuture(editorId)
          if (!next) return null
          const out = yield* next.forwardEffect(editor)
          yield* history.pushPreserveFuture(editorId, {
            ...next,
            output: out,
            at: Date.now(),
          })
          return next
        })

      const dryRun = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<Out, Err | NotReversibleError | CommandValidationError, Exclude<R, CurrentEditor>> =>
        (Effect.gen(function* () {
          const validated = yield* decodeInput(cmd, input)
          if (typeof cmd.reverse !== "function") {
            return yield* Effect.fail(new NotReversibleError({ op: cmd.op }))
          }
          const rawOutput = yield* cmd.forward(validated).pipe(
            Effect.provideService(CurrentEditor, editor),
          )
          const out = yield* decodeOutput(cmd, rawOutput)
          if (typeof cmd.reverse === "function") {
            yield* cmd.reverse(validated, out).pipe(Effect.provideService(CurrentEditor, editor))
          }
          return out
        }))

      const isPending = (editorId: EditorId, op: string): Effect.Effect<boolean> =>
        Effect.map(SubscriptionRef.get(pendingOps), (all) => all.get(editorId)?.has(op) ?? false)

      const pendingChanges = (editorId: EditorId): Stream.Stream<ReadonlySet<string>> =>
        pendingOps.changes.pipe(
          Stream.map((all) => all.get(editorId) ?? emptyPendingOps),
          Stream.changes,
        )

      return {
        run,
        undo,
        redo,
        dryRun,
        isPending,
        pendingChanges,
        interruptAllForEditor,
        notReversibleEvents,
        commandFailedEvents,
      } as const
    }),
    dependencies: [CommandHistory.Default],
  },
) {}

export const CommandExecutorLive: Layer.Layer<CommandExecutor | CommandHistory> =
  Layer.merge(CommandExecutor.Default, CommandHistory.Default)
