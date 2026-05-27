import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Step } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { Data, Effect } from "effect";

/**
 * A per-editor mutable record of the step inversions accumulated for the
 * currently-active transactional Command. The dispatch wrapper appends to
 * `inversions` on every transaction dispatched while a context is active;
 * the executor replays them on Command failure or interruption.
 */
export interface TransactionalContext {
  readonly cmdId: string;
  readonly inversions: Array<Step>;
}

const ROLLBACK_META = "tiptap-effect/non-transactional";
const TAG_META = "tiptap-effect/cmd-tx-id";
const WRAPPED_FLAG = "_tiptapEffectDispatchWrapped";

/**
 * STACK of active transactional contexts per editor — replaces the previous
 * single-slot WeakMap. Two transactional commands can run concurrently on
 * the same editor; each gets its own context so their inversions don't
 * interleave. Every dispatched transaction is captured by EVERY active
 * context (each one needs to roll back the step if it fails). Order of
 * the stack determines roll-back order if both fail.
 */
const contextStacks = new WeakMap<TiptapEditor, Array<TransactionalContext>>();

type WrappedEditorView = EditorView & {
  [WRAPPED_FLAG]?: boolean;
  dispatch: (tr: Transaction) => void;
};

export class TransactionalRollbackError extends Data.TaggedError(
  "TransactionalRollbackError",
)<{
  readonly phase: "install";
  readonly cause: unknown;
}> {}

const invertStep = (
  step: Step,
  docBeforeStep: ProseMirrorNode,
  cmdIds: string,
): Effect.Effect<Step | null> =>
  Effect.try(() => step.invert(docBeforeStep)).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning(
        "[tiptap-effect/transactionalRollback] failed to invert step",
        { cause, cmdIds },
      ),
    ),
    Effect.orElse(() => Effect.succeed(null)),
  );

const applyInversion = (
  transaction: Transaction,
  inversion: Step,
): Effect.Effect<Transaction> =>
  Effect.try(() => transaction.step(inversion)).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning(
        "[tiptap-effect/transactionalRollback] failed to replay inversion",
        { cause },
      ),
    ),
    Effect.orElse(() => Effect.succeed(transaction)),
  );

const stackFor = (editor: TiptapEditor): Array<TransactionalContext> => {
  let stack = contextStacks.get(editor);
  if (!stack) {
    stack = [];
    contextStacks.set(editor, stack);
  }
  return stack;
};

export const setContext = (
  editor: TiptapEditor,
  ctx: TransactionalContext,
): void => {
  stackFor(editor).push(ctx);
};

export const clearContext = (editor: TiptapEditor, cmdId?: string): void => {
  const stack = contextStacks.get(editor);
  if (!stack || stack.length === 0) return;
  if (cmdId === undefined) {
    stack.pop();
  } else {
    // Remove the matching context, preserving the relative order of the rest.
    const idx = stack.findIndex((c) => c.cmdId === cmdId);
    if (idx >= 0) stack.splice(idx, 1);
  }
  if (stack.length === 0) contextStacks.delete(editor);
};

/**
 * Idempotently wrap `editor.view.dispatch` so transactions dispatched WHILE
 * any TransactionalContext is active get their step inversions captured by
 * EVERY active context. The wrapper also tags the transaction with each
 * active cmd id (audit hook); rollback transactions themselves carry the
 * `ROLLBACK_META` flag so they don't get re-captured.
 */
export const installDispatchWrapper = (
  editor: TiptapEditor,
): Effect.Effect<void, TransactionalRollbackError> =>
  Effect.try({
    try: () => editor.view as WrappedEditorView | undefined,
    catch: (cause) =>
      new TransactionalRollbackError({ phase: "install", cause }),
  }).pipe(
    Effect.flatMap((view) =>
      Effect.sync(() => {
        if (!view || view[WRAPPED_FLAG]) return;
        view[WRAPPED_FLAG] = true;
        const original = view.dispatch.bind(view);
        view.dispatch = (tr: Transaction) => {
          const stack = contextStacks.get(editor);
          if (stack && stack.length > 0 && !tr.getMeta(ROLLBACK_META)) {
            const tagIds = stack.map((c) => c.cmdId).join(",");
            tr.setMeta(TAG_META, tagIds);
            const before = tr.before;
            const docs = tr.docs as ReadonlyArray<ProseMirrorNode>;
            for (let i = 0; i < tr.steps.length; i++) {
              const step = tr.steps[i];
              const docBeforeStep = i === 0 ? before : docs[i - 1];
              if (!step || !docBeforeStep) continue;
              const inverted = Effect.runSync(
                invertStep(step, docBeforeStep, tagIds),
              );
              if (!inverted) continue;
              for (const ctx of stack) {
                ctx.inversions.unshift(inverted);
              }
            }
          }
          return original(tr);
        };
      }),
    ),
  );

/**
 * Apply the captured step inversions in reverse-of-dispatch order to roll
 * the doc back. The replay transaction is tagged `ROLLBACK_META` so the
 * dispatch wrapper doesn't re-capture (which would create an infinite
 * loop).
 */
export const replayInversions: (
  editor: TiptapEditor,
  inversions: ReadonlyArray<Step>,
) => Effect.Effect<void> = Effect.fnUntraced(function* (
  editor: TiptapEditor,
  inversions: ReadonlyArray<Step>,
) {
  if (inversions.length === 0) return;

  const view = yield* Effect.try({
    try: () => editor.view as WrappedEditorView,
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.logWarning(
        "[tiptap-effect/transactionalRollback] failed to access editor view for replay",
        { cause },
      ).pipe(Effect.as(null)),
    ),
  );
  if (!view) return;

  let tr: Transaction = editor.state.tr;
  for (const inv of inversions) {
    tr = yield* applyInversion(tr, inv);
  }
  yield* Effect.sync(() => {
    tr.setMeta(ROLLBACK_META, true);
    view.dispatch(tr);
  });
});

/**
 * Backwards-compat helper used by tests/diagnostics. Returns the topmost
 * active context for the given editor (the most recently pushed). The
 * single-slot getter from the previous implementation; new callers should
 * iterate `getActiveContexts(editor)` if they need all of them.
 */
export const getContext = (
  editor: TiptapEditor,
): TransactionalContext | undefined => {
  const stack = contextStacks.get(editor);
  if (!stack || stack.length === 0) return undefined;
  return stack[stack.length - 1];
};

export const getActiveContexts = (
  editor: TiptapEditor,
): ReadonlyArray<TransactionalContext> => {
  return contextStacks.get(editor) ?? [];
};
