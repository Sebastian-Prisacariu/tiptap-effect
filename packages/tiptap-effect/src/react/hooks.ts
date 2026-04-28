import { Result, useAtomValue, RegistryContext } from "@effect-atom/atom-react"
import type { Atom, Registry } from "@effect-atom/atom"
import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect, Stream } from "effect"
import * as React from "react"
import type { Command } from "../command.js"
import {
  CommandExecutor,
  type CommandFailed,
} from "../command-executor.js"
import type { CommandRecord } from "../command-history.js"
import { futureRecordsAtom, pastRecordsAtom } from "../history-atoms.js"
import { commandPendingAtom } from "../pending-atoms.js"
import { editorRuntime } from "../runtime.js"
import { useEditorScope } from "./EditorScope.js"
import type { EditorId } from "../types.js"

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

const runOneShotAtom = <A, E>(
  registry: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Promise<A> => {
  // editorRuntime (Atom.runtime(TiptapLayer)) already provides CommandExecutor
  // via the registry-scoped TiptapLayer. Do NOT re-provide it here — that would
  // shadow the shared CommandHistory with a fresh one and break undo.
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
    const unsub = registry.subscribe(oneShot, tryResolve)
    if (tryResolve(registry.get(oneShot))) return
  })
}

const runOneShotResult = <A, E>(
  registry: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Promise<Result.Result<A, E>> => {
  const oneShot = editorRuntime.atom(effect)
  return new Promise<Result.Result<A, E>>((resolve) => {
    const tryResolve = (r: Result.Result<A, E>) => {
      if (Result.isSuccess(r) || Result.isFailure(r)) {
        unsub()
        resolve(r)
        return true
      }
      return false
    }
    const unsub = registry.subscribe(oneShot, tryResolve)
    if (tryResolve(registry.get(oneShot))) return
  })
}

/**
 * Dispatch a Command. Returns a Promise that resolves on Success and rejects
 * on Failure. Most ergonomic of the three dispatch variants — pair with
 * try/catch.
 *
 * Throws if called before the editor has fully constructed (initial Result).
 */
export const useDispatch = (): (<Op extends string, In, Out, Err>(
  cmd: Command<Op, In, Out, Err, any>,
  input: In,
) => Promise<Out>) => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  return React.useCallback(
    <Op extends string, In, Out, Err>(
      cmd: Command<Op, In, Out, Err, any>,
      input: In,
    ): Promise<Out> => {
      if (!Result.isSuccess(result)) {
        return Promise.reject(new Error("tiptap-effect: editor not ready"))
      }
      const editor = result.value._internal.editor
      const effect = Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, cmd, input)
      }) as unknown as Effect.Effect<Out, Err, CommandExecutor>
      return runOneShotAtom<Out, Err>(registry, effect)
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
  cmd: Command<Op, In, Out, Err, any>,
  input: In,
) => Effect.Effect<Out, Err>) => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  return React.useCallback(
    <Op extends string, In, Out, Err>(
      cmd: Command<Op, In, Out, Err, any>,
      input: In,
    ): Effect.Effect<Out, Err> => {
      if (!Result.isSuccess(result)) {
        return Effect.fail(
          new Error("tiptap-effect: editor not ready") as unknown as Err,
        )
      }
      const editor = result.value._internal.editor
      // Wrap the runOneShotAtom Promise (which goes through editorRuntime so
      // CommandExecutor is satisfied) in Effect.tryPromise. The error channel
      // matches the cmd's declared Err.
      return Effect.tryPromise({
        try: () =>
          runOneShotAtom<Out, Err>(
            registry,
            Effect.gen(function* () {
              const exec = yield* CommandExecutor
              return yield* exec.run(editor, cmd, input)
            }) as unknown as Effect.Effect<Out, Err, CommandExecutor>,
          ),
        catch: (cause) => cause as Err,
      })
    },
    [result, registry],
  )
}

/**
 * Dispatch a Command and receive a `Promise<Result<Out, Err>>`. Useful when
 * you want to handle success/failure in a single branch without try/catch.
 */
export const useDispatchPromise = (): (<Op extends string, In, Out, Err>(
  cmd: Command<Op, In, Out, Err, any>,
  input: In,
) => Promise<Result.Result<Out, Err>>) => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  return React.useCallback(
    async <Op extends string, In, Out, Err>(
      cmd: Command<Op, In, Out, Err, any>,
      input: In,
    ): Promise<Result.Result<Out, Err>> => {
      if (!Result.isSuccess(result)) {
        return Result.failure({
          _tag: "Error",
          error: new Error("tiptap-effect: editor not ready") as unknown as Err,
        } as never) as Result.Result<Out, Err>
      }
      const editor = result.value._internal.editor
      return await runOneShotResult<Out, Err>(
        registry,
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return yield* exec.run(editor, cmd, input)
        }) as unknown as Effect.Effect<Out, Err, CommandExecutor>,
      )
    },
    [result, registry],
  )
}

/**
 * Undo/redo controls bound to the current scope's editor, plus the live
 * past/future record arrays for inline timeline UIs (e.g. an undo dropdown).
 *
 * `past` and `future` are read via `useAtomValue` so the component re-renders
 * exactly when the corresponding history stack changes.
 */
export const useHistory = (): {
  readonly undo: () => Promise<void>
  readonly redo: () => Promise<void>
  readonly past: ReadonlyArray<CommandRecord>
  readonly future: ReadonlyArray<CommandRecord>
} => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  const registry = useRegistry()

  const pastResult = useAtomValue(pastRecordsAtom)
  const futureResult = useAtomValue(futureRecordsAtom)
  const past = Result.isSuccess(pastResult) ? pastResult.value : []
  const future = Result.isSuccess(futureResult) ? futureResult.value : []

  const controls = React.useMemo(() => {
    const guarded = (run: (editor: TiptapEditor) => Promise<unknown>) =>
      async () => {
        if (!Result.isSuccess(result)) {
          throw new Error("tiptap-effect: editor not ready")
        }
        await run(result.value._internal.editor)
      }
    return {
      undo: guarded((editor) =>
        runOneShotAtom(
          registry,
          Effect.gen(function* () {
            const exec = yield* CommandExecutor
            yield* exec.undo(editor)
          }) as Effect.Effect<void, unknown, CommandExecutor>,
        ),
      ),
      redo: guarded((editor) =>
        runOneShotAtom(
          registry,
          Effect.gen(function* () {
            const exec = yield* CommandExecutor
            yield* exec.redo(editor)
          }) as Effect.Effect<void, unknown, CommandExecutor>,
        ),
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
  const atom = React.useMemo(() => commandPendingAtom(op), [op])
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
            Stream.fromPubSub(exec.commandFailedEvents),
          ),
        ),
      ),
    [],
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
 * can be greppe'd.
 */
export const useRawEditor = (opts: { unsafe: true }): TiptapEditor | null => {
  // Argument exists purely as a typed marker; ignored at runtime.
  void opts
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  if (!Result.isSuccess(result)) return null
  return result.value._internal.editor
}
