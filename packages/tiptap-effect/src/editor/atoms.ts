import { Atom, Result } from "@effect-atom/atom"
import { Effect, Either, ParseResult, Stream } from "effect"
import { editorRuntime } from "../runtime"
import { TransactionBus } from "../runtime/internal/transaction-bus"
import type { EditorSchema } from "../schema/define"
import type { EditorId, TransactionSnapshot } from "../types"
import {
  type DecodedDocument,
  decodeDocumentFromState,
  type DocumentJsonError,
  documentHtmlFromState,
} from "./internal/document-validation"
import { projectSelection } from "../internal/project-selection"

/**
 * Per-editor atom that mirrors the latest TransactionSnapshot pushed to the
 * bus. Slice atoms derive from this via `Atom.map` so React only re-renders
 * the slices whose projection changed.
 */
export const transactionBusAtom = Atom.family((editorId: EditorId) =>
  editorRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const bus = yield* TransactionBus
        return bus.stream(editorId)
      }),
    ),
  ),
)

const unwrapSnap = (
  r: Result.Result<TransactionSnapshot, never>,
): TransactionSnapshot | null => (Result.isSuccess(r) ? r.value : null)

type NamedMark = { readonly type: { readonly name: string } }
type MarkSelectionState = {
  readonly schema: { readonly marks: Record<string, unknown> }
  readonly selection: {
    readonly from: number
    readonly to: number
    readonly empty: boolean
    readonly $from: { readonly marks?: () => ReadonlyArray<NamedMark> }
  }
  readonly doc: { readonly rangeHasMark: (from: number, to: number, mark: unknown) => boolean }
  readonly storedMarks?: ReadonlyArray<NamedMark> | null
}

/**
 * Selection slice atom. Reads from the latest transaction snapshot's state.
 * Returns `null` until the first transaction emits.
 */
export const selectionAtom = (editorId: EditorId) =>
  Atom.map(transactionBusAtom(editorId), (r) => {
    const snap = unwrapSnap(r)
    if (!snap) return null
    return projectSelection(snap.stateAfter)
  })

/**
 * Whether `markName` is active at the current selection.
 */
export const isActiveAtom = (editorId: EditorId, markName: string) =>
  Atom.map(transactionBusAtom(editorId), (r) => {
    const snap = unwrapSnap(r)
    if (!snap) return false
    const state = snap.stateAfter as MarkSelectionState
    const markType = state.schema.marks[markName]
    if (!markType) return false
    if (state.selection.empty) {
      const stored = state.storedMarks
      if (stored) return stored.some((m) => m.type.name === markName)
      const $from = state.selection.$from
      return ($from?.marks?.() ?? []).some(
        (m) => m.type.name === markName,
      )
    }
    return state.doc.rangeHasMark(state.selection.from, state.selection.to, markType)
  })

/**
 * Derived selection helpers.
 */
export const selectedTextAtom = (editorId: EditorId) =>
  Atom.map(transactionBusAtom(editorId), (r) => {
    const snap = unwrapSnap(r)
    if (!snap) return ""
    const state = snap.stateAfter as {
      doc: { textBetween: (a: number, b: number, sep?: string) => string }
      selection: { from: number; to: number }
    }
    return state.doc.textBetween(state.selection.from, state.selection.to, " ")
  })

export const hasSelectionAtom = (editorId: EditorId) =>
  Atom.map(selectionAtom(editorId), (sel) => {
    if (sel === null) return false
    if (sel.kind === "text") return !sel.empty
    return true
  })

export const isCollapsedAtom = (editorId: EditorId) =>
  Atom.map(selectionAtom(editorId), (sel) => sel?.kind === "text" && sel.empty)

/**
 * Plain text serialisation of the doc. Recomputed on every transaction.
 */
export const plainTextAtom = (editorId: EditorId) =>
  Atom.map(transactionBusAtom(editorId), (r) => {
    const snap = unwrapSnap(r)
    if (!snap) return ""
    const state = snap.stateAfter as {
      doc: { textBetween: (a: number, b: number, sep?: string) => string; content: { size: number } }
    }
    return state.doc.textBetween(0, state.doc.content.size, "\n")
  })

/**
 * Focus state of the editor. Defaults to false until a focus event flows.
 */
export const focusAtom = (editorId: EditorId) =>
  Atom.map(transactionBusAtom(editorId), (r) => {
    const snap = unwrapSnap(r)
    if (!snap) return false
    return snap.sourceMeta.includes("focus")
  })

/**
 * The current doc as a typed `NodeJSON`, decoded against `schema.Document`.
 *
 * Returns `null` until the first transaction emits, then `Either.right(doc)`
 * on successful schema decode and `Either.left(parseError)` on failure.
 *
 * Lazy: `Schema.decodeUnknown` is not invoked until a subscriber reads this
 * atom — `Atom.map` does not run its projection unless someone observes it.
 *
 * Equality-checked through `Atom.map`'s built-in equivalence, so identical
 * doc projections do not notify subscribers.
 */
export const docAtom = <
  N extends Record<string, unknown>,
  M extends Record<string, unknown>,
>(
  editorId: EditorId,
  schema: EditorSchema<N, M>,
) =>
  Atom.map(transactionBusAtom(editorId), (
    r,
  ): Either.Either<
    DecodedDocument<N, M>,
    ParseResult.ParseError | DocumentJsonError
  > | null => {
    const snap = unwrapSnap(r)
    if (!snap) return null
    const decoded = decodeDocumentFromState(schema, snap.stateAfter)
    if (Either.isLeft(decoded)) {
      return Either.left(decoded.left)
    }
    return Either.right(decoded.right)
  })

/**
 * Current HTML rendering of the doc via static serialization.
 *
 * Returns the empty string until the first transaction emits or when the
 * snapshot cannot be decoded against the provided schema.
 */
export const htmlAtom = <
  N extends Record<string, unknown>,
  M extends Record<string, unknown>,
>(
  editorId: EditorId,
  schema: EditorSchema<N, M>,
) =>
  Atom.map(transactionBusAtom(editorId), (r) => {
    const snap = unwrapSnap(r)
    if (!snap) return ""
    const html = documentHtmlFromState(schema, snap.stateAfter)
    return Either.isRight(html) ? html.right : ""
  })
