import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Effect, Either } from "effect";

const COMMAND_ORIGIN_META = "tiptap-effect/command-origin";
const HISTORY_RESTORE_META = "tiptap-effect/history-restore";

const activeCommandOrigins = new WeakMap<TiptapEditor, Array<string>>();
const activeHistoryRestores = new WeakSet<TiptapEditor>();
const wrappedViews = new WeakSet<EditorView>();

type WrappedEditorView = EditorView & {
  dispatch: (tr: Transaction) => void;
};

const originStackFor = (editor: TiptapEditor): Array<string> => {
  let stack = activeCommandOrigins.get(editor);
  if (!stack) {
    stack = [];
    activeCommandOrigins.set(editor, stack);
  }
  return stack;
};

export const installTransactionOriginWrapper = (
  editor: TiptapEditor,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const view = Either.try(
      () => editor.view as WrappedEditorView | undefined,
    ).pipe(Either.getOrUndefined);
    if (!view || wrappedViews.has(view)) return;
    wrappedViews.add(view);
    const original = view.dispatch.bind(view);
    view.dispatch = (tr: Transaction) => {
      const stack = activeCommandOrigins.get(editor);
      if (stack && stack.length > 0 && !isHistoryRestoreTransaction(tr)) {
        tr.setMeta(COMMAND_ORIGIN_META, stack.join(","));
      }
      return original(tr);
    };
  });

export const withCommandOrigin = <A, E, R>(
  editor: TiptapEditor,
  op: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* installTransactionOriginWrapper(editor);
    const stack = originStackFor(editor);
    stack.push(op);
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const current = activeCommandOrigins.get(editor);
          if (!current) return;
          const idx = current.lastIndexOf(op);
          if (idx >= 0) current.splice(idx, 1);
          if (current.length === 0) activeCommandOrigins.delete(editor);
        }),
      ),
    );
  });

export const isCommandOriginActive = (editor: TiptapEditor): boolean => {
  const stack = activeCommandOrigins.get(editor);
  return stack !== undefined && stack.length > 0;
};

export const withHistoryRestore = <A, E, R>(
  editor: TiptapEditor,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    activeHistoryRestores.add(editor);
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          activeHistoryRestores.delete(editor);
        }),
      ),
    );
  });

export const isHistoryRestoreActive = (editor: TiptapEditor): boolean =>
  activeHistoryRestores.has(editor);

export const tagHistoryRestore = (tr: Transaction): Transaction =>
  tr.setMeta(HISTORY_RESTORE_META, true);

const getMetaSafe = (
  tr: { readonly getMeta: (key: string) => unknown },
  key: string,
): unknown => Either.try(() => tr.getMeta(key)).pipe(Either.getOrUndefined);

export const isCommandOriginTransaction = (tr: {
  readonly getMeta: (key: string) => unknown;
}): boolean => getMetaSafe(tr, COMMAND_ORIGIN_META) !== undefined;

export const isHistoryRestoreTransaction = (tr: {
  readonly getMeta: (key: string) => unknown;
}): boolean => getMetaSafe(tr, HISTORY_RESTORE_META) === true;

export const shouldRecordNativeHistory = (tr: {
  readonly docChanged: boolean;
  readonly getMeta?: (key: string) => unknown;
}): boolean => {
  if (!tr.docChanged || typeof tr.getMeta !== "function") return false;
  const getMeta = (key: string) => tr.getMeta?.(key);
  return (
    !isCommandOriginTransaction({ getMeta }) &&
    !isHistoryRestoreTransaction({ getMeta })
  );
};
