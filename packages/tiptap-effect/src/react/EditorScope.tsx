'use client';

import type { Atom } from "@effect-atom/atom"
import * as React from "react"
import type { EditorHandle, EditorInitError, EditorSpec } from "../editor"
import type { CreatedEditor } from "../create-editor"
import type { AnyEditorSchema } from "../schema"
import type { EditorId } from "../types"
import type { Result } from "@effect-atom/atom"

type AnyCreatedEditor = CreatedEditor<AnyEditorSchema, Record<string, unknown>>
type EditorScopeSpec = Omit<
  EditorSpec<Record<string, unknown>, Record<string, unknown>>,
  "id" | "schema"
>

export interface ScopedEditorContextValue<
  N extends Record<string, unknown> = Record<string, unknown>,
  M extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: EditorId
  readonly editor: AnyCreatedEditor
  readonly spec: EditorSpec<N, M>
  readonly atom: Atom.Atom<Result.Result<EditorHandle, EditorInitError>>
}

export const ScopedEditorContext =
  React.createContext<ScopedEditorContextValue | null>(null)

/**
 * Provider for a single editor instance scoped to its React subtree.
 *
 * Creates the editor atom once per `id`. `<TiptapView />` and the
 * `use*` hooks read the atom from this context and never need an explicit
 * `atom` prop. Multi-editor pages stack/sibling multiple `<EditorScope>`s.
 *
 * Must be rendered inside a `<RegistryProvider />` from `@effect-atom/atom-react`.
 */
export const EditorScope: React.FC<{
  id: EditorId
  editor: AnyCreatedEditor
  spec: EditorScopeSpec
  children: React.ReactNode
}> = ({ id, editor, spec, children }) => {
  // Memoise the atom by id. Spec changes on the same id do NOT recreate the
  // atom — surgical updates flow through `editableAtom` etc.
  const atom = React.useMemo(() => editor.makeAtom({ id, ...spec }), [editor, id])
  const fullSpec = React.useMemo(
    () => ({ id, ...spec, schema: editor.schema }),
    [editor.schema, id, spec],
  )
  const value = React.useMemo<ScopedEditorContextValue>(
    () => ({ id, editor, spec: fullSpec, atom }),
    [id, editor, fullSpec, atom],
  )
  return (
    <ScopedEditorContext.Provider value={value}>
      {children}
    </ScopedEditorContext.Provider>
  )
}

export const useEditorScope = (): ScopedEditorContextValue => {
  const ctx = React.useContext(ScopedEditorContext)
  if (!ctx) {
    throw new Error(
      "tiptap-effect: hook must be called inside an <EditorScope>",
    )
  }
  return ctx
}
