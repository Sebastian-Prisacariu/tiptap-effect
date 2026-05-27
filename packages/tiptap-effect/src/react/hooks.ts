import { Result, useAtomValue, RegistryContext } from "@effect-atom/atom-react"
import { type Atom, Registry } from "@effect-atom/atom"
import type { Editor as TiptapEditor } from "@tiptap/core"
import { Data, Effect, Exit, Stream } from "effect"
import * as React from "react"
import {
  CommandBusyError,
  CommandExecutor,
  type CommandFailed,
  type CommandRecord,
  commandPendingAtom,
  futureRecordsAtom,
  pastRecordsAtom,
  type CommandValidationError,
  type EditorRunnableCommand,
  type NotReversibleError,
  type TransactionalRollbackError,
} from "../command"
import { editorRuntime } from "../runtime"
import { useEditorScope } from "./EditorScope"
import { useNodeViewProps } from "./NodeViewContext"
import type { EditorId } from "../types"

export class DispatchNotReadyError extends Data.TaggedError("DispatchNotReadyError")<{
  readonly message: string
}> {}

type DispatchError<Err> =
  | Err
  | CommandValidationError
  | CommandBusyError
  | NotReversibleError
  | TransactionalRollbackError
  | DispatchNotReadyError

export type DispatchMode = "effect" | "promise" | "result"

export type DispatchEffect = <Op extends string, In, Out, Err>(
  cmd: EditorRunnableCommand<Op, In, Out, Err>,
  input: In,
) => Effect.Effect<Out, DispatchError<Err>>

export type DispatchPromise = <Op extends string, In, Out, Err>(
  cmd: EditorRunnableCommand<Op, In, Out, Err>,
  input: In,
) => Promise<Out>

export type DispatchResult = <Op extends string, In, Out, Err>(
  cmd: EditorRunnableCommand<Op, In, Out, Err>,
  input: In,
) => Promise<Result.Result<Out, DispatchError<Err>>>

export type UseDispatchOptions<M extends DispatchMode = "effect"> = {
  readonly mode?: M
}

/**
 * Read a slice atom (e.g. `selectionAtom`, `isActiveAtom("bold")`).
 * The slice factory is called with the current scope's `EditorId`.
 *
 * Re-renders only when the slice's projected value actually changes
 * (slice atoms are equality-checked).
 *
 * Pass `{ debounceMs }` to coalesce rapid changes — the hook still subscribes
 * to every emission but only commits the latest value to the consumer once
 * the window settles. Useful for `docAtom` against persistence side effects:
 * typing 10 characters inside a 1500ms window fires the consumer once.
 */
export function useEditorSlice<T>(factory: (id: EditorId) => Atom.Atom<T>): T
export function useEditorSlice<T>(
  factory: (id: EditorId) => Atom.Atom<T>,
  options: { readonly debounceMs: number },
): T
export function useEditorSlice<T>(
  factory: (id: EditorId) => Atom.Atom<T>,
  options?: { readonly debounceMs?: number },
): T {
  const { id } = useEditorScope()
  const atom = factory(id)
  const live = useAtomValue(atom)
  const [debounced, setDebounced] = React.useState<T>(live)
  const debounceMs = options?.debounceMs

  React.useEffect(() => {
    if (debounceMs === undefined) return
    const timer = setTimeout(() => setDebounced(live), debounceMs)
    return () => clearTimeout(timer)
  }, [live, debounceMs])

  return debounceMs === undefined ? live : debounced
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
  options?: { readonly debounceMs?: number },
): void => {
  const value = options?.debounceMs === undefined
    ? useEditorSlice(factory)
    : useEditorSlice(factory, { debounceMs: options.debounceMs })
  const handlerRef = React.useRef(handler)
  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])
  React.useEffect(() => {
    handlerRef.current(value)
  }, [value])
}

type EditorEventName = "transaction" | "selectionUpdate" | "focus" | "blur"
type EditorStateLike = {
  on: (event: EditorEventName, handler: () => void) => void
  off: (event: EditorEventName, handler: () => void) => void
}

export type EditorStateSnapshot<TEditor extends EditorStateLike | null = EditorStateLike | null> = {
  readonly editor: TEditor
  readonly transactionNumber: number
}

export interface UseEditorStateOptions<
  TSelectorResult,
  TEditor extends EditorStateLike | null,
> {
  readonly editor: TEditor
  readonly selector: (snapshot: EditorStateSnapshot<TEditor>) => TSelectorResult
  readonly equalityFn?: (a: TSelectorResult, b: TSelectorResult) => boolean
}

const defaultEditorStateEquality = <A,>(a: A, b: A): boolean => Object.is(a, b)

export function useEditorState<TSelectorResult, TEditor extends EditorStateLike>(
  options: UseEditorStateOptions<TSelectorResult, TEditor>,
): TSelectorResult
export function useEditorState<
  TSelectorResult,
  TEditor extends EditorStateLike | null,
>(
  options: UseEditorStateOptions<TSelectorResult, TEditor>,
): TSelectorResult | null
export function useEditorState<TSelectorResult>(
  options:
    | UseEditorStateOptions<TSelectorResult, EditorStateLike>
    | UseEditorStateOptions<TSelectorResult, EditorStateLike | null>,
): TSelectorResult | null {
  const { editor, selector, equalityFn = defaultEditorStateEquality } = options
  const [transactionNumber, setTransactionNumber] = React.useState(0)
  const lastValue = React.useRef<TSelectorResult | null>(null)

  React.useEffect(() => {
    setTransactionNumber(0)
    if (!editor) return
    const update = () => setTransactionNumber((number) => number + 1)
    editor.on("transaction", update)
    editor.on("selectionUpdate", update)
    editor.on("focus", update)
    editor.on("blur", update)
    return () => {
      editor.off("transaction", update)
      editor.off("selectionUpdate", update)
      editor.off("focus", update)
      editor.off("blur", update)
    }
  }, [editor])

  return React.useMemo(() => {
    if (!editor) {
      lastValue.current = null
      return null
    }
    const selected = selector({ editor, transactionNumber })
    if (
      lastValue.current !== null
      && equalityFn(lastValue.current, selected)
    ) {
      return lastValue.current
    }
    lastValue.current = selected
    return selected
  }, [editor, transactionNumber, selector, equalityFn])
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

const runOneShotEffect = <A, E>(
  registry: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Effect.Effect<A, E> =>
  Effect.promise(() => runOneShotResult(registry, effect)).pipe(
    Effect.flatMap(resultToEffect),
  )

const effectToResultPromise = <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Result.Result<A, E>> =>
  Effect.runPromiseExit(effect).then(Result.fromExit)

/**
 * Dispatch a Command. The default mode returns `Effect<Out, Err>` so command
 * calls compose naturally with `Effect.gen`.
 *
 * Use `{ mode: "promise" }` for React event handlers that want a rejecting
 * Promise, or `{ mode: "result" }` when the boundary should never throw.
 */
export function useDispatch(): DispatchEffect
export function useDispatch(options: UseDispatchOptions<"effect">): DispatchEffect
export function useDispatch(options: UseDispatchOptions<"promise">): DispatchPromise
export function useDispatch(options: UseDispatchOptions<"result">): DispatchResult
export function useDispatch(
  options: UseDispatchOptions<DispatchMode> = {},
): DispatchEffect | DispatchPromise | DispatchResult {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()
  const mode = options.mode ?? "effect"

  const dispatchEffect = React.useCallback(
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
      const effect = Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, cmd, input)
      })
      return runOneShotEffect<Out, DispatchError<Err>>(registry, effect)
    },
    [result, registry],
  )

  return React.useMemo(() => {
    if (mode === "promise") {
      return <Op extends string, In, Out, Err>(
        cmd: EditorRunnableCommand<Op, In, Out, Err>,
        input: In,
      ): Promise<Out> => Effect.runPromise(dispatchEffect(cmd, input))
    }
    if (mode === "result") {
      return <Op extends string, In, Out, Err>(
        cmd: EditorRunnableCommand<Op, In, Out, Err>,
        input: In,
      ): Promise<Result.Result<Out, DispatchError<Err>>> =>
        effectToResultPromise(dispatchEffect(cmd, input))
    }
    return dispatchEffect
  }, [dispatchEffect, mode])
}

/**
 * Undo/redo controls bound to the current scope's editor, plus the live
 * past/future record arrays for inline timeline UIs (e.g. an undo dropdown).
 *
 * `past` and `future` are read via `useAtomValue` so the component re-renders
 * exactly when the corresponding history stack changes.
 */
export const useHistory = (): {
  readonly undo: () => Effect.Effect<CommandRecord | null, unknown>
  readonly redo: () => Effect.Effect<CommandRecord | null, unknown>
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
      (): Effect.Effect<CommandRecord | null, unknown> => {
        if (!Result.isSuccess(result)) {
          return Effect.fail(
            new DispatchNotReadyError({ message: "tiptap-effect: editor not ready" }),
          )
        }
        return runOneShotEffect(registry, run(result.value._internal.editor))
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

export const useHistoryPromise = (): {
  readonly undo: () => Promise<Result.Result<CommandRecord | null, unknown>>
  readonly redo: () => Promise<Result.Result<CommandRecord | null, unknown>>
  readonly past: ReadonlyArray<CommandRecord>
  readonly future: ReadonlyArray<CommandRecord>
} => {
  const history = useHistory()
  return React.useMemo(
    () => ({
      past: history.past,
      future: history.future,
      undo: () => effectToResultPromise(history.undo()),
      redo: () => effectToResultPromise(history.redo()),
    }),
    [history],
  )
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

export const useNodeViewActions = <Attrs extends Record<string, unknown> = Record<string, unknown>>(): {
  readonly updateAttrs: (
    attrs: Partial<Attrs>,
  ) => Effect.Effect<unknown, DispatchError<unknown> | Error>
  readonly deleteNode: () => Effect.Effect<unknown, DispatchError<unknown> | Error>
  readonly replaceNode: (
    content: unknown,
  ) => Effect.Effect<unknown, DispatchError<unknown> | Error>
} => {
  const dispatch = useDispatch()
  const { nodeType, getPos } = useNodeViewProps<Attrs>()
  const { editor } = useEditorScope()

  const requirePos = React.useCallback((): Effect.Effect<number, Error> =>
    Effect.sync(() => getPos()).pipe(
      Effect.flatMap((pos) =>
        pos === undefined
          ? Effect.fail(new Error("tiptap-effect: NodeView position is no longer available"))
          : Effect.succeed(pos),
      ),
    ), [getPos])

  return React.useMemo(
    () => ({
      updateAttrs: (attrs) =>
        Effect.flatMap(requirePos(), (pos) =>
          dispatch(editor.commands.updateNodeAttrsAt, {
            pos,
            type: nodeType,
            attrs: attrs as Record<string, unknown>,
          }),
        ),
      deleteNode: () =>
        Effect.flatMap(requirePos(), (pos) =>
          dispatch(editor.commands.deleteNodeAt, { pos }),
        ),
      replaceNode: (content) =>
        Effect.flatMap(requirePos(), (pos) =>
          dispatch(editor.commands.replaceNodeAt, { pos, content: content as never }),
        ),
    }),
    [dispatch, editor.commands, nodeType, requirePos],
  )
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
