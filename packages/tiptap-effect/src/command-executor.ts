import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect, Fiber, Layer, PubSub, Ref, Schema, type Stream, SubscriptionRef } from "effect"
import { type Command, NotReversibleError, Reverse } from "./command.js"
import { CommandHistory, type CommandRecord, reverseKind } from "./command-history.js"
import { CurrentEditor } from "./current-editor.js"
import { projectSelection } from "./internal/project-selection.js"
import {
  clearContext,
  installDispatchWrapper,
  replayInversions,
  setContext,
} from "./internal/transactional-rollback.js"
import type { SelectionInfo } from "./schema/selection.js"

/**
 * Event emitted on the first Cmd-Z against a Reverse.notReversible entry.
 */
export interface NotReversibleAttempt {
  readonly op: string
  readonly at: number
}

/**
 * Raised when a Command with `concurrencyPolicy: "block-while-pending"` (the
 * default) is dispatched while a same-op command is already in flight.
 */
export class CommandBusyError {
  readonly _tag = "CommandBusyError" as const
  constructor(readonly op: string) {}
}

/**
 * Event published on the `commandFailedEvents` PubSub for every Command that
 * fails (any policy). Interruptions do NOT publish this event — only true
 * failures.
 */
export interface CommandFailed {
  readonly op: string
  readonly cause: unknown
  readonly at: number
}

const A3_TOGGLE_WINDOW_MS = 3000

let cmdIdCounter = 0
const nextCmdId = (op: string): string => `${op}-${Date.now()}-${cmdIdCounter++}`

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
      const a3State = yield* Ref.make<{ op: string; at: number } | null>(null)
      const notReversibleEvents = yield* PubSub.unbounded<NotReversibleAttempt>()
      const commandFailedEvents = yield* PubSub.unbounded<CommandFailed>()
      const pendingOps = yield* SubscriptionRef.make<ReadonlySet<string>>(new Set())
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
        cmd: Command<any, any, any, any, any>,
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

      const markPending = (op: string) =>
        SubscriptionRef.update(pendingOps, (s) => {
          const n = new Set(s)
          n.add(op)
          return n
        })

      const unmarkPending = (op: string) =>
        SubscriptionRef.update(pendingOps, (s) => {
          if (!s.has(op)) return s
          const n = new Set(s)
          n.delete(op)
          return n
        })

      const getOrCreateSemaphore = (op: string): Effect.Effect<Effect.Semaphore> =>
        Effect.gen(function* () {
          let sem = perOpSemaphores.get(op)
          if (!sem) {
            sem = yield* Effect.makeSemaphore(1)
            perOpSemaphores.set(op, sem)
          }
          return sem
        })

      const realRun = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<Out, Err, Exclude<R, CurrentEditor>> =>
        (Effect.gen(function* () {
          const validated = (yield* Schema.decodeUnknown(cmd.inputSchema)(input)) as In
          const selection = captureSelection(editor, cmd)
          const out = (yield* cmd.forward(validated).pipe(
            Effect.provideService(CurrentEditor, editor),
          )) as Out
          const coalesceKey = cmd.coalesceKey ? cmd.coalesceKey(validated) : undefined
          const record: CommandRecord<Op, In, Out> = {
            op: cmd.op,
            cmd: cmd as Command<Op, In, Out, any, any>,
            input: validated,
            output: out,
            at: Date.now(),
            selection,
            coalesceKey,
          }
          yield* history.pushCoalesced(record as CommandRecord)
          yield* Ref.set(a3State, null)
          return out
        })) as Effect.Effect<Out, Err, Exclude<R, CurrentEditor>>

      /**
       * Wrap `realRun` with: pendingOps tracking, commandFailedEvents
       * publication on failure (not on interrupt), per-editor fiber
       * registration (for editor-disposal interrupt), optional per-op fiber
       * registration (for interrupt-and-replace), and optional transactional
       * rollback (for `cmd.transactional`).
       */
      const tracked = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
        opts: { trackOp?: boolean } = {},
      ): Effect.Effect<Out, Err, Exclude<R, CurrentEditor>> =>
        (Effect.gen(function* () {
          const op = cmd.op
          const isTransactional = !!(cmd as { transactional?: boolean }).transactional
          const cmdId = nextCmdId(op)
          // inversions array shared with the dispatch wrapper (mutable)
          const inversions: Array<unknown> = []

          if (isTransactional) {
            installDispatchWrapper(editor)
            setContext(editor, { cmdId, inversions })
          }

          yield* markPending(op)

          const inner = realRun(editor, cmd, input).pipe(
            Effect.tapErrorCause((cause) =>
              PubSub.publish(commandFailedEvents, {
                op,
                cause,
                at: Date.now(),
              }),
            ),
          )

          const fiber = (yield* Effect.fork(inner)) as Fiber.RuntimeFiber<Out, Err>
          // Register per-editor for disposal-time interrupt
          let editorSet = perEditorFibers.get(editor)
          if (!editorSet) {
            editorSet = new Set()
            perEditorFibers.set(editor, editorSet)
          }
          const erased = fiber as unknown as Fiber.RuntimeFiber<unknown, unknown>
          editorSet.add(erased)
          if (opts.trackOp) perOpFibers.set(op, erased)

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
                if (opts.trackOp && perOpFibers.get(op) === erased) {
                  perOpFibers.delete(op)
                }
                if (isTransactional) clearContext(editor)
                yield* unmarkPending(op)
              }),
            ),
          )
        })) as Effect.Effect<Out, Err, Exclude<R, CurrentEditor>>

      const run = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<Out, Err | NotReversibleError | CommandBusyError, Exclude<R, CurrentEditor>> => {
        const op = cmd.op
        const policy = cmd.concurrencyPolicy ?? "block-while-pending"

        switch (policy) {
          case "block-while-pending": {
            return Effect.gen(function* () {
              const set = yield* SubscriptionRef.get(pendingOps)
              if (set.has(op)) {
                return yield* Effect.fail(new CommandBusyError(op))
              }
              return yield* tracked(editor, cmd, input)
            }) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError,
              Exclude<R, CurrentEditor>
            >
          }
          case "queue": {
            return Effect.gen(function* () {
              const sem = yield* getOrCreateSemaphore(op)
              return yield* sem.withPermits(1)(tracked(editor, cmd, input))
            }) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError,
              Exclude<R, CurrentEditor>
            >
          }
          case "interrupt-and-replace": {
            return Effect.gen(function* () {
              const existing = perOpFibers.get(op)
              if (existing) {
                yield* Fiber.interrupt(existing)
                perOpFibers.delete(op)
              }
              return yield* tracked(editor, cmd, input, { trackOp: true })
            }) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError,
              Exclude<R, CurrentEditor>
            >
          }
          case "allow-concurrent": {
            return tracked(editor, cmd, input) as Effect.Effect<
              Out,
              Err | NotReversibleError | CommandBusyError,
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
      ): Effect.Effect<CommandRecord | null, NotReversibleError, never> =>
        Effect.gen(function* () {
          // Cmd-Z while a Command is in-flight: interrupt the in-flight
          // fiber(s) first. If the cmd was `transactional: true`, its
          // interrupt path already replayed the step inversions.
          yield* interruptAllForEditor(editor)
          const last = yield* history.popLast()
          if (!last) return null
          const kind = reverseKind(last.cmd.reverse)
          if (kind === Reverse.skipOnUndo) {
            return yield* undo(editor)
          }
          if (kind === Reverse.notReversible) {
            const now = Date.now()
            const prev = yield* Ref.get(a3State)
            const armed =
              prev !== null && prev.op === last.op && now - prev.at <= A3_TOGGLE_WINDOW_MS
            if (armed) {
              yield* Ref.set(a3State, null)
              return yield* undo(editor)
            }
            yield* history.push(last)
            yield* Ref.set(a3State, { op: last.op, at: now })
            yield* PubSub.publish(notReversibleEvents, { op: last.op, at: now })
            return yield* Effect.fail(new NotReversibleError(last.op))
          }
          restoreSelection(editor, last.selection)
          const reverseFn = last.cmd.reverse as (
            i: unknown,
            o: unknown,
          ) => Effect.Effect<void, never, CurrentEditor>
          yield* reverseFn(last.input, last.output).pipe(
            Effect.provideService(CurrentEditor, editor),
          )
          yield* history.pushFuture(last)
          yield* Ref.set(a3State, null)
          return last
        }) as Effect.Effect<CommandRecord | null, NotReversibleError, never>

      const redo = (
        editor: TiptapEditor,
      ): Effect.Effect<CommandRecord | null, NotReversibleError, never> =>
        Effect.gen(function* () {
          const next = yield* history.popFuture()
          if (!next) return null
          const cmd = next.cmd as Command<string, unknown, unknown, never, CurrentEditor>
          const out = (yield* cmd.forward(next.input).pipe(
            Effect.provideService(CurrentEditor, editor),
          )) as unknown
          yield* history.pushPreserveFuture({
            ...next,
            output: out,
            at: Date.now(),
          })
          return next
        }) as Effect.Effect<CommandRecord | null, NotReversibleError, never>

      const dryRun = <Op extends string, In, Out, Err, R>(
        editor: TiptapEditor,
        cmd: Command<Op, In, Out, Err, R>,
        input: In,
      ): Effect.Effect<Out, Err | NotReversibleError, Exclude<R, CurrentEditor>> =>
        (Effect.gen(function* () {
          const validated = (yield* Schema.decodeUnknown(cmd.inputSchema)(input)) as In
          const kind = reverseKind(cmd.reverse)
          if (kind !== "function") {
            return yield* Effect.fail(new NotReversibleError(cmd.op))
          }
          const out = (yield* cmd.forward(validated).pipe(
            Effect.provideService(CurrentEditor, editor),
          )) as Out
          const reverseFn = cmd.reverse as (
            i: In,
            o: Out,
          ) => Effect.Effect<void, Err, CurrentEditor>
          yield* reverseFn(validated, out).pipe(
            Effect.provideService(CurrentEditor, editor),
          )
          return out
        }) as unknown) as Effect.Effect<
          Out,
          Err | NotReversibleError,
          Exclude<R, CurrentEditor>
        >

      const isPending = (op: string): Effect.Effect<boolean> =>
        Effect.map(SubscriptionRef.get(pendingOps), (s) => s.has(op))

      const pendingChanges: Stream.Stream<ReadonlySet<string>> = pendingOps.changes

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
