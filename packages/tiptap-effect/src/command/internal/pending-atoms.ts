import { Atom } from "@effect-atom/atom"
import { Effect, Stream } from "effect"
import { CommandExecutor } from "../command-executor"
import { editorRuntime } from "../../runtime"
import type { EditorId } from "../../types"

const commandPendingAtomFamily = Atom.family(
  ({ editorId, op }: { readonly editorId: EditorId; readonly op: string }) =>
    editorRuntime.atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          return exec.pendingChanges(editorId).pipe(
            Stream.map((s) => s.has(op)),
            Stream.changes,
          )
        }),
      ),
    ),
)

export const commandPendingAtom = (editorId: EditorId, op: string) =>
  commandPendingAtomFamily({ editorId, op })
