import { Atom } from "@effect-atom/atom";
import { Array, Effect, Stream } from "effect";
import { CommandHistory, type CommandRecord } from "../command-history";
import { editorRuntime } from "../../runtime";
import type { EditorId } from "../../types";

export const undoableAtom = Atom.family((editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const history = yield* CommandHistory;
        return history
          .pastChanges(editorId)
          .pipe(Stream.map(Array.isNonEmptyReadonlyArray), Stream.changes);
      }),
    ),
  ),
);

export const redoableAtom = Atom.family((editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const history = yield* CommandHistory;
        return history
          .futureChanges(editorId)
          .pipe(Stream.map(Array.isNonEmptyReadonlyArray), Stream.changes);
      }),
    ),
  ),
);

export const pastRecordsAtom = Atom.family((editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const history = yield* CommandHistory;
        return history.pastChanges(editorId);
      }),
    ),
  ),
);

export const futureRecordsAtom = Atom.family((editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const history = yield* CommandHistory;
        return history.futureChanges(editorId);
      }),
    ),
  ),
);

export type { CommandRecord };
