import { Effect, Stream } from "effect"
import { CommandExecutor } from "./command-executor.js"
import { editorRuntime } from "./runtime.js"

/**
 * `true` while at least one Command with the given `op` is in flight (per
 * `CommandExecutor.pendingChanges`). De-duped via `Stream.changes` so React
 * subscribers only re-render on actual transitions.
 *
 * Usage: `useAtomValue(commandPendingAtom("tiptap-effect.set-content"))` to
 * disable a Save button while a save is in progress.
 */
export const commandPendingAtom = (op: string) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return exec.pendingChanges.pipe(
          Stream.map((s) => s.has(op)),
          Stream.changes,
        )
      }),
    ),
  )
