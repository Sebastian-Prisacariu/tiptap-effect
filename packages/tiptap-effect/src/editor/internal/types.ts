import type { Atom } from "@effect-atom/atom"
import type { Extensions } from "@tiptap/core"
import { Data } from "effect"
import type { EditorSchema } from "../../schema/define"
import type { EditorId } from "../../types"

export class EditorInitError extends Data.TaggedError("EditorInitError")<{
  readonly cause: unknown
}> {}

export type EditorSchemaNodes = Record<string, unknown>
export type EditorSchemaMarks = Record<string, unknown>

export interface EditorSpec<
  N extends EditorSchemaNodes = EditorSchemaNodes,
  M extends EditorSchemaMarks = EditorSchemaMarks,
> {
  readonly id: EditorId
  readonly schema: EditorSchema<N, M>
  readonly defaultContent: unknown
  readonly extensions?: Extensions
  readonly editable?: boolean
  readonly editorProps?: Record<string, unknown>
  readonly editableAtom?: Atom.Writable<boolean>
}
