import { Result, useAtomValue, RegistryContext } from "@effect-atom/atom-react"
import { type Atom, Registry } from "@effect-atom/atom"
import type { Editor as TiptapEditor } from "@tiptap/core"
import { Data, Effect, Exit, Stream } from "effect"
import * as React from "react"
import type {
  CommandValidationError,
  EditorRunnableCommand,
  NotReversibleError,
} from "../command"
import {
  CommandBusyError,
  CommandExecutor,
  type CommandFailed,
} from "../command/command-executor"
import type { CommandRecord } from "../command/command-history"
import { futureRecordsAtom, pastRecordsAtom } from "../command/internal/history-atoms"
import { commandPendingAtom } from "../command/internal/pending-atoms"
import { editorRuntime } from "../runtime"
import { useEditorScope } from "./EditorScope"
import type { EditorId } from "../types"

export class DispatchNotReadyError extends Data.TaggedError("DispatchNotReadyError")<{
  readonly message: string
}> {}

type DispatchError<Err> =
  | Err
  | CommandValidationError
  | CommandBusyError
  | NotReversibleError
  | DispatchNotReadyError

/**
 * Read a slice atom (e.g. `selectionAtom`, `isActiveAtom("bold")`).
 * The slice factory is called with the current scope's `EditorId`.
 *
 * Re-renders only when the slice's projected value actually changes
 * (slice atoms are equality-checked).
 */
export const useEditorSlice = <T,>(
  factory: (id: EditorId) => Atom.Atom<T>,
): T => {
  const { id } = useEditorScope()
  const atom = factory(id)
  return useAtomValue(atom)
}

/**
 * Subscribe to a slice atom with a side-effect callback. Useful for "fire a
 * server save when `dirtyAtom` flips to true" or "play a chime when
 * `selectionAtom` changes" without forcing a component re-render. The
 * callback is invoked on every emission of the underlying atom.
 *
 * Cleanup is automatic: the subscription is unbound on unmount or when the
 * dependency identity changes.
 */
export const useEditorSubscribe = <T,>(
  factory: (id: EditorId) => Atom.Atom<T>,
  handler: (value: T) => void,
): void => {
  const value = useEditorSlice(factory)
  const handlerRef = React.useRef(handler)
  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])
  React.useEffect(() => {
    handlerRef.current(value)
  }, [value])
}

const useRegistry = (): Registry.Registry => {
  const r = React.useContext(RegistryContext)
  if (!r) {
    throw new Error(
      "tiptap-effect: missing <RegistryContext.Provider> from @effect-atom/atom-react",
    )
  }
  return r
}

const runOneShotExit = <A, E>(
  registry: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Promise<Exit.Exit<A, E>> => {
  // editorRuntime (Atom.runtime(TiptapLayer)) already provides CommandExecutor
  // via the registry-scoped TiptapLayer. Do NOT re-provide it here — that would
  // shadow the shared CommandHistory with a fresh one and break undo.
  const oneShot = editorRuntime.atom(effect)
  return Effect.runPromiseExit(
    Registry.getResult(registry, oneShot, { suspendOnWaiting: true }),
  )
}

const runOneShotResult = <A, E>(
  registry: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Promise<Result.Result<A, E>> =>
  runOneShotExit(registry, effect).then(Result.fromExit)

const resultToEffect = <A, E>(
  result: Result.Result<A, E>,
): Effect.Effect<A, E> => {
  if (Result.isSuccess(result)) return Effect.succeed(result.value)
  if (Result.isFailure(result)) return Effect.failCause(result.cause)
  return Effect.never
}

/**
 * Dispatch a Command and receive a `Promise<Result<Out, Err>>`. Useful when
 * you want to handle success/failure in a single branch without try/catch.
 */
export const useDispatch = (): (<Op extends string, In, Out, Err>(
  cmd: EditorRunnableCommand<Op, In, Out, Err>,
  input: In,
) => Promise<Result.Result<Out, DispatchError<Err>>>) => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  return React.useCallback(
    <Op extends string, In, Out, Err>(
      cmd: EditorRunnableCommand<Op, In, Out, Err>,
      input: In,
    ): Promise<Result.Result<Out, DispatchError<Err>>> => {
      if (!Result.isSuccess(result)) {
        return Promise.resolve(
          Result.fail<DispatchError<Err>, Out>(
            new DispatchNotReadyError({ message: "tiptap-effect: editor not ready" }),
          ),
        )
      }
      const editor = result.value._internal.editor
      const effect = Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, cmd, input)
      })
      return runOneShotResult<Out, DispatchError<Err>>(registry, effect)
    },
    [result, registry],
  )
}

/**
 * Dispatch a Command and receive an `Effect<Out, Err>` instead of a Promise.
 * Use when you want to compose the dispatch into a larger Effect program
 * (retries, parallel composition, mapErrors). The returned Effect already
 * has `CommandExecutor` provided via the package's runtime — consumers don't
 * need to provide a layer.
 */
export const useDispatchEffect = (): (<Op extends string, In, Out, Err>(
  cmd: EditorRunnableCommand<Op, In, Out, Err>,
  input: In,
) => Effect.Effect<Out, DispatchError<Err>>) => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  return React.useCallback(
    <Op extends string, In, Out, Err>(
      cmd: EditorRunnableCommand<Op, In, Out, Err>,
      input: In,
    ): Effect.Effect<Out, DispatchError<Err>> => {
      if (!Result.isSuccess(result)) {
        return Effect.fail(
          new DispatchNotReadyError({ message: "tiptap-effect: editor not ready" }),
        )
      }
      const editor = result.value._internal.editor
      return Effect.promise(() =>
        runOneShotResult<Out, DispatchError<Err>>(
          registry,
          Effect.gen(function* () {
            const exec = yield* CommandExecutor
            return yield* exec.run(editor, cmd, input)
          }),
        ),
      ).pipe(Effect.flatMap(resultToEffect))
    },
    [result, registry],
  )
}

/**
 * Backwards-compatible alias for `useDispatch`.
 */
export const useDispatchPromise = useDispatch

/**
 * Undo/redo controls bound to the current scope's editor, plus the live
 * past/future record arrays for inline timeline UIs (e.g. an undo dropdown).
 *
 * `past` and `future` are read via `useAtomValue` so the component re-renders
 * exactly when the corresponding history stack changes.
 */
export const useHistory = (): {
  readonly undo: () => Promise<Result.Result<CommandRecord | null, unknown>>
  readonly redo: () => Promise<Result.Result<CommandRecord | null, unknown>>
  readonly past: ReadonlyArray<CommandRecord>
  readonly future: ReadonlyArray<CommandRecord>
} => {
  const { id, atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  const pastResult = useAtomValue(pastRecordsAtom(id))
  const futureResult = useAtomValue(futureRecordsAtom(id))
  const past = Result.isSuccess(pastResult) ? pastResult.value : []
  const future = Result.isSuccess(futureResult) ? futureResult.value : []

  const controls = React.useMemo(() => {
    const guarded = (
      run: (editor: TiptapEditor) => Effect.Effect<CommandRecord | null, unknown, CommandExecutor>,
    ) =>
      (): Promise<Result.Result<CommandRecord | null, unknown>> => {
        if (!Result.isSuccess(result)) {
          return Promise.resolve(
            Result.fail<unknown, CommandRecord | null>(
              new DispatchNotReadyError({ message: "tiptap-effect: editor not ready" }),
            ),
          )
        }
        return runOneShotResult(registry, run(result.value._internal.editor))
      }
    return {
      undo: guarded((editor) =>
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.undo(editor)
        }),
      ),
      redo: guarded((editor) =>
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.redo(editor)
        }),
      ),
    }
  }, [result, registry])

  return { ...controls, past, future }
}

/**
 * `true` while a Command with the given `op` is in flight (per
 * `commandPendingAtom`). Bind the disabled state of a Save button to this so
 * users can't double-click into a `block-while-pending` CommandBusyError.
 *
 * The underlying atom is `Atom<Result<boolean, never>>` (it lifts a Stream).
 * Before the first emission the Result is `Initial`; we conservatively treat
 * that as `false` (no pending dispatch yet).
 */
export const useCommandPending = (op: string): boolean => {
  const { id } = useEditorScope()
  const atom = React.useMemo(() => commandPendingAtom(id, op), [id, op])
  const r = useAtomValue(atom)
  return Result.isSuccess(r) ? r.value : false
}

/**
 * Subscribe to `CommandExecutor.commandFailedEvents` for non-blocking error
 * surfacing (toasts, telemetry). The handler is invoked on every published
 * `CommandFailed` event for the lifetime of the component.
 *
 * Cleanup is automatic on unmount.
 */
export const useCommandErrors = (
  handler: (event: CommandFailed) => void,
): void => {
  const { id } = useEditorScope()
  const handlerRef = React.useRef(handler)
  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])
  // Stream-shaped atom: each CommandFailed event becomes the atom's current
  // value. We then react to value changes via useEffect to invoke the handler.
  // This matches the pattern of commandPendingAtom (Stream-shaped, subscribed
  // via useAtomValue) which is known to work end-to-end through the runtime.
  const atom = React.useMemo(
    () =>
      editorRuntime.atom(
        Stream.unwrap(
          Effect.map(CommandExecutor, (exec) =>
            Stream.fromPubSub(exec.commandFailedEvents).pipe(
              Stream.filter((event) => event.editorId === id),
            ),
          ),
        ),
      ),
    [id],
  )
  const r = useAtomValue(atom)
  React.useEffect(() => {
    if (Result.isSuccess(r)) {
      handlerRef.current(r.value)
    }
  }, [r])
}

/**
 * Escape hatch: returns the raw Tiptap Editor instance.
 *
 * @advanced Mutations made through this handle BYPASS the Command system —
 * they will NOT appear in undo history, will NOT be auditable, and will NOT
 * be replayable. Reach for `useDispatch` and a `Command` first; only use
 * this hook when wrapping a one-off Tiptap-native operation that doesn't
 * yet have a Command wrapper.
 *
 * The required `{ unsafe: true }` argument is a code-review marker so usages
 * can be grepped.
 */
export const useRawEditor = (opts: { unsafe: true }): TiptapEditor | null => {
  // Argument exists purely as a typed marker; ignored at runtime.
  void opts
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  if (!Result.isSuccess(result)) return null
  return result.value._internal.editor
}
