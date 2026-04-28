import type { Editor as TiptapEditor } from "@tiptap/core"

/**
 * A per-editor mutable record of the step inversions accumulated for the
 * currently-active transactional Command. The dispatch wrapper appends to
 * `inversions` on every transaction dispatched while a context is set; the
 * executor replays them on Command failure or interruption.
 */
export interface TransactionalContext {
  readonly cmdId: string
  readonly inversions: Array<unknown>
}

const ROLLBACK_META = "tiptap-effect/non-transactional"
const TAG_META = "tiptap-effect/cmd-tx-id"
const WRAPPED_FLAG = "_tiptapEffectDispatchWrapped"

const contexts = new WeakMap<TiptapEditor, TransactionalContext>()

export const setContext = (editor: TiptapEditor, ctx: TransactionalContext): void => {
  contexts.set(editor, ctx)
}

export const clearContext = (editor: TiptapEditor): void => {
  contexts.delete(editor)
}

export const getContext = (editor: TiptapEditor): TransactionalContext | undefined =>
  contexts.get(editor)

/**
 * Idempotently wrap `editor.view.dispatch` so transactions dispatched WHILE a
 * `TransactionalContext` is set get their step inversions captured. The
 * wrapper also tags the dispatched transaction with the cmd id (audit hook
 * for downstream readers); rollback transactions themselves carry the
 * `ROLLBACK_META` flag so they don't get re-captured.
 */
export const installDispatchWrapper = (editor: TiptapEditor): void => {
  const view = (editor as unknown as { view: any }).view
  if (!view || view[WRAPPED_FLAG]) return
  view[WRAPPED_FLAG] = true
  const original = view.dispatch.bind(view)
  view.dispatch = (tr: any) => {
    const ctx = contexts.get(editor)
    if (ctx && !tr.getMeta(ROLLBACK_META)) {
      tr.setMeta(TAG_META, ctx.cmdId)
      const before = tr.before
      const docs = tr.docs as ReadonlyArray<unknown>
      for (let i = 0; i < tr.steps.length; i++) {
        const step = tr.steps[i]
        const docBeforeStep = i === 0 ? before : docs[i - 1]
        try {
          ctx.inversions.unshift(step.invert(docBeforeStep))
        } catch {
          // Some steps don't support invert (rare in core PM); skip silently
        }
      }
    }
    return original(tr)
  }
}

/**
 * Apply the captured step inversions in reverse-of-dispatch order to roll the
 * doc back. The replay transaction is tagged `ROLLBACK_META` so the dispatch
 * wrapper doesn't re-capture (which would create an infinite loop).
 */
export const replayInversions = (
  editor: TiptapEditor,
  inversions: ReadonlyArray<unknown>,
): void => {
  if (inversions.length === 0) return
  const view = (editor as unknown as { view: any }).view
  let tr = (editor as unknown as { state: { tr: any } }).state.tr
  for (const inv of inversions) {
    try {
      tr = tr.step(inv)
    } catch {
      // Inversion may not apply if the doc has diverged further; skip
    }
  }
  tr.setMeta(ROLLBACK_META, true)
  view.dispatch(tr)
}
