import type { Editor as TiptapEditor } from "@tiptap/core"
import { Effect, PubSub, Ref } from "effect"
import { NotReversibleError, Reverse } from "../command"
import {
  CommandHistory,
  type CommandRecord,
  getReverseFn,
  reverseKind,
} from "../command-history"
import { getEditorId } from "../../internal/editor-ids"
import type { SelectionInfo } from "../../schema/selection"
import type { EditorId } from "../../types"

const A3_TOGGLE_WINDOW_MS = 3000

type A3State = { readonly op: string; readonly at: number }

export interface NotReversibleAttempt {
  readonly editorId: EditorId
  readonly op: string
  readonly at: number
}

const restoreSelection = (
  editor: TiptapEditor,
  sel: SelectionInfo | null | undefined,
): void => {
  if (!sel) return
  if (sel.kind === "text" || sel.kind === "all") {
    editor.commands.setTextSelection({ from: sel.from, to: sel.to })
  } else if (sel.kind === "node") {
    editor.commands.setNodeSelection(sel.pos)
  }
}

export const makeCommandHistoryNavigation = Effect.fnUntraced(function* (deps: {
  readonly history: CommandHistory
  readonly interruptAllForEditor: (editor: TiptapEditor) => Effect.Effect<void>
}) {
  const a3State = yield* Ref.make<ReadonlyMap<EditorId, A3State>>(new Map())
  const notReversibleEvents =
    yield* PubSub.unbounded<NotReversibleAttempt>()

  const clearA3State = (editorId: EditorId) =>
    Ref.update(a3State, (all) => {
      if (!all.has(editorId)) return all
      const next = new Map(all)
      next.delete(editorId)
      return next
    })

  const onCommandRecorded = (editorId: EditorId) => clearA3State(editorId)

  const undo: (
    editor: TiptapEditor,
  ) => Effect.Effect<CommandRecord | null, unknown> = Effect.fnUntraced(function* (
    editor: TiptapEditor,
  ) {
    const editorId = getEditorId(editor)
    yield* deps.interruptAllForEditor(editor)
    const last = yield* deps.history.popLast(editorId)
    if (!last) return null
    const kind = reverseKind(last.reverseEffect)
    if (kind === Reverse.skipOnUndo) {
      return yield* undo(editor)
    }
    if (kind === Reverse.notReversible) {
      const now = Date.now()
      const prev = (yield* Ref.get(a3State)).get(editorId) ?? null
      const armed =
        prev !== null && prev.op === last.op && now - prev.at <= A3_TOGGLE_WINDOW_MS
      if (armed) {
        yield* clearA3State(editorId)
        return yield* undo(editor)
      }
      yield* deps.history.pushPreserveFuture(editorId, last)
      yield* Ref.update(a3State, (all) => {
        const next = new Map(all)
        next.set(editorId, { op: last.op, at: now })
        return next
      })
      yield* PubSub.publish(notReversibleEvents, {
        editorId,
        op: last.op,
        at: now,
      })
      return yield* new NotReversibleError({ op: last.op })
    }
    yield* Effect.sync(() => restoreSelection(editor, last.selection))
    const reverseFn = getReverseFn(last.reverseEffect)
    if (reverseFn) {
      yield* reverseFn(editor, last.output)
    }
    yield* deps.history.pushFuture(editorId, last)
    yield* clearA3State(editorId)
    return last
  })

  const redo: (
    editor: TiptapEditor,
  ) => Effect.Effect<CommandRecord | null, unknown> = Effect.fnUntraced(function* (
    editor: TiptapEditor,
  ) {
    const editorId = getEditorId(editor)
    const next = yield* deps.history.popFuture(editorId)
    if (!next) return null
    const out = yield* next.forwardEffect(editor)
    yield* deps.history.pushPreserveFuture(editorId, {
      ...next,
      output: out,
      at: Date.now(),
    })
    return next
  })

  return {
    undo,
    redo,
    onCommandRecorded,
    notReversibleEvents,
  } as const
})

export type CommandHistoryNavigation = Effect.Effect.Success<
  ReturnType<typeof makeCommandHistoryNavigation>
>
