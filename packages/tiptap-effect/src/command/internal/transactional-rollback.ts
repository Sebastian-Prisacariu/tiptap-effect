import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import type { Step } from "@tiptap/pm/transform"
import type { EditorView } from "@tiptap/pm/view"

/**
 * A per-editor mutable record of the step inversions accumulated for the
 * currently-active transactional Command. The dispatch wrapper appends to
 * `inversions` on every transaction dispatched while a context is set; the
 * executor replays them on Command failure or interruption.
 */
export interface TransactionalContext {
  readonly cmdId: string
  readonly inversions: Array<Step>
}

const ROLLBACK_META = "tiptap-effect/non-transactional"
const TAG_META = "tiptap-effect/cmd-tx-id"
const WRAPPED_FLAG = "_tiptapEffectDispatchWrapped"

const contexts = new WeakMap<TiptapEditor, TransactionalContext>()

type WrappedEditorView = EditorView & {
  [WRAPPED_FLAG]?: boolean
  dispatch: (tr: Transaction) => void
}

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
  const view = editor.view as WrappedEditorView | undefined
  if (!view || view[WRAPPED_FLAG]) return
  view[WRAPPED_FLAG] = true
  const original = view.dispatch.bind(view)
  view.dispatch = (tr: Transaction) => {
    const ctx = contexts.get(editor)
    if (ctx && !tr.getMeta(ROLLBACK_META)) {
      tr.setMeta(TAG_META, ctx.cmdId)
      const before = tr.before
      const docs = tr.docs as ReadonlyArray<ProseMirrorNode>
      for (let i = 0; i < tr.steps.length; i++) {
        const step = tr.steps[i]
        const docBeforeStep = i === 0 ? before : docs[i - 1]
        if (!step || !docBeforeStep) continue
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
  inversions: ReadonlyArray<Step>,
): void => {
  if (inversions.length === 0) return
  const view = editor.view as WrappedEditorView
  let tr: Transaction = editor.state.tr
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
