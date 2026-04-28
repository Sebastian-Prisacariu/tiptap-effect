import { Effect, Stream } from "effect"
import { CommandHistory, type CommandRecord } from "./command-history.js"
import { editorRuntime } from "./runtime.js"

/**
 * True when the live undo stack has at least one reversible-or-skipOnUndo
 * entry (current MVP: any entry; A3 toggle handles notReversible at the
 * point of attempting undo).
 *
 * Toolbar buttons read this for enabled/disabled state.
 */
export const undoableAtom = editorRuntime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const history = yield* CommandHistory
      return history.pastChanges.pipe(
        Stream.map((arr) => arr.length > 0),
        Stream.changes,
      )
    }),
  ),
)

/**
 * True when the future stack is non-empty (i.e. the user has undone at least
 * one command and hasn't dispatched a new one since).
 */
export const redoableAtom = editorRuntime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const history = yield* CommandHistory
      return history.futureChanges.pipe(
        Stream.map((arr) => arr.length > 0),
        Stream.changes,
      )
    }),
  ),
)

/**
 * The current past stack as a `ReadonlyArray<CommandRecord>` — read by
 * `useHistory().past` for inline timeline UIs (e.g. an undo dropdown that
 * shows the last N commands by description).
 */
export const pastRecordsAtom = editorRuntime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const history = yield* CommandHistory
      return history.pastChanges as Stream.Stream<ReadonlyArray<CommandRecord>>
    }),
  ),
)

/**
 * The current future stack as a `ReadonlyArray<CommandRecord>` (records that
 * have been undone and are available for redo).
 */
export const futureRecordsAtom = editorRuntime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const history = yield* CommandHistory
      return history.futureChanges as Stream.Stream<ReadonlyArray<CommandRecord>>
    }),
  ),
)
