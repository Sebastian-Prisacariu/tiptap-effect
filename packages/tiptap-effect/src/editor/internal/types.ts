import type { Atom } from "@effect-atom/atom"
import type { Extensions } from "@tiptap/core"
import { Data } from "effect"
import type { EditorSchema } from "../../schema/define"
import type { EditorId } from "../../types"

export class EditorInitError extends Data.TaggedError("EditorInitError")<{
  readonly cause: unknown
}> {}

export class SchemaCollisionError extends Data.TaggedError("SchemaCollisionError")<{
  readonly collisions: ReadonlyArray<string>
  readonly message: string
}> {}

export type EditorSchemaNodes = Record<string, unknown>
export type EditorSchemaMarks = Record<string, unknown>
export type SchemaMismatchPolicy = "throw" | "log" | "ignore"

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
  /**
   * Reactive variant of `extensions`. When the atom value changes, the
   * editor atom REBUILDS — old editor destroyed, fresh editor created with
   * the new extensions list. PM schema can only be set at construction so
   * extension changes always require a rebuild.
   */
  readonly extensionsAtom?: Atom.Writable<Extensions>
  /**
   * Reactive variant of `editorProps`. When the atom changes we call
   * `editor.setOptions({ editorProps })` — no rebuild.
   */
  readonly editorPropsAtom?: Atom.Writable<Record<string, unknown>>
  /**
   * Policy for editor-state documents that no longer decode against
   * `schema.Document`. Defaults to `"log"`. Set to `"ignore"` to skip the
   * per-transaction decode, or `"throw"` to fail fast on mismatch.
   */
  readonly onSchemaMismatch?: SchemaMismatchPolicy
}
