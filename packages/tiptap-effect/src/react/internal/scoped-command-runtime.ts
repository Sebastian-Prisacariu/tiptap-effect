import { type Atom, Registry } from "@effect-atom/atom"
import { RegistryContext, Result } from "@effect-atom/atom-react"
import { Effect, Exit, Stream } from "effect"
import * as React from "react"
import { CommandExecutor } from "../../command"
import { editorRuntime } from "../../runtime"

type CommandRuntimeEffect<A, E> = Effect.Effect<A, E, CommandExecutor>

export interface ScopedCommandRuntime {
  readonly runExit: <A, E>(
    effect: CommandRuntimeEffect<A, E>,
  ) => Promise<Exit.Exit<A, E>>
  readonly runResult: <A, E>(
    effect: CommandRuntimeEffect<A, E>,
  ) => Promise<Result.Result<A, E>>
  readonly runEffect: <A, E>(
    effect: CommandRuntimeEffect<A, E>,
  ) => Effect.Effect<A, E>
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
  effect: CommandRuntimeEffect<A, E>,
): Promise<Exit.Exit<A, E>> => {
  // editorRuntime (Atom.runtime(TiptapLayer)) already provides CommandExecutor
  // via the registry-scoped TiptapLayer. Do not re-provide it here: that would
  // shadow the shared CommandHistory with a fresh one and break undo.
  const oneShot = editorRuntime.atom(effect)
  return Effect.runPromiseExit(
    Registry.getResult(registry, oneShot, { suspendOnWaiting: true }),
  )
}

const resultToEffect = <A, E>(
  result: Result.Result<A, E>,
): Effect.Effect<A, E> => {
  if (Result.isSuccess(result)) return Effect.succeed(result.value)
  if (Result.isFailure(result)) return Effect.failCause(result.cause)
  return Effect.never
}

export const effectToResultPromise = <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Result.Result<A, E>> =>
  Effect.runPromiseExit(effect).then(Result.fromExit)

export const useScopedCommandRuntime = (): ScopedCommandRuntime => {
  const registry = useRegistry()

  return React.useMemo(() => {
    const runExit = <A, E>(effect: CommandRuntimeEffect<A, E>) =>
      runOneShotExit(registry, effect)
    const runResult = <A, E>(effect: CommandRuntimeEffect<A, E>) =>
      runExit(effect).then(Result.fromExit)
    const runEffect = <A, E>(effect: CommandRuntimeEffect<A, E>) =>
      Effect.promise(() => runResult(effect)).pipe(Effect.flatMap(resultToEffect))

    return {
      runExit,
      runResult,
      runEffect,
    } as const
  }, [registry])
}

export const commandExecutorStreamAtom = <A>(
  makeStream: (exec: CommandExecutor) => Stream.Stream<A>,
): Atom.Atom<Result.Result<A, never>> =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.map(CommandExecutor, makeStream),
    ),
  )
