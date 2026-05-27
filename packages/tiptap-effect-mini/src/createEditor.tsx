import { useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import type { Atom, Result } from "@effect-atom/atom"
import type { SetContentOptions } from "@tiptap/core"
import { Effect, Either } from "effect"
import * as React from "react"
import type * as Editor from "./Editor"
import * as EditorAtom from "./EditorAtom"
import * as BaseReact from "./EditorReact"
import {
  documentAtom,
  EditorUnavailable,
  InvalidDocument,
  InvalidInsertion,
  InvalidNode,
  type AnyEditorSchema,
  type DocumentOf,
  type NodeOf,
} from "./schema"

type ProviderOptions = Omit<Editor.Options, "extensions" | "content" | "element">
type InsertableNodeOf<S extends AnyEditorSchema> = Exclude<NodeOf<S>, { readonly type: "doc" }>
type TypedContent<S extends AnyEditorSchema> = DocumentOf<S> | string

export type ProviderProps<S extends AnyEditorSchema> = ProviderOptions & {
  readonly id?: Editor.Id
  readonly content?: TypedContent<S>
  readonly children: React.ReactNode
}

export interface BoundCommands<S extends AnyEditorSchema> {
  readonly setContent: (
    content: DocumentOf<S>,
    options?: SetContentOptions,
  ) => Effect.Effect<void, InvalidDocument | EditorUnavailable>
  readonly insertContentAt: (
    pos: number,
    content: InsertableNodeOf<S> | ReadonlyArray<InsertableNodeOf<S>>,
  ) => Effect.Effect<void, InvalidNode | InvalidInsertion | EditorUnavailable>
}

export interface CreatedEditor<S extends AnyEditorSchema> {
  readonly schema: S
  readonly Provider: React.FC<ProviderProps<S>>
  readonly Content: typeof BaseReact.Content
  readonly useId: () => Editor.Id
  readonly useEditor: () => Editor.Editor | null
  readonly useSnapshot: () => Editor.Snapshot | null
  readonly useState: typeof BaseReact.useState
  readonly useSubscribe: typeof BaseReact.useSubscribe
  readonly useDocument: () => Result.Result<DocumentOf<S>, InvalidDocument> | null
  readonly useHTML: () => string | null
  readonly useText: () => string | null
  readonly useCommands: () => BoundCommands<S>
  readonly atoms: {
    readonly document: (
      id: Editor.Id,
    ) => Atom.Atom<Result.Result<DocumentOf<S>, InvalidDocument> | null>
    readonly html: (id: Editor.Id) => Atom.Atom<string | null>
    readonly text: (id: Editor.Id) => Atom.Atom<string | null>
    readonly snapshot: (id: Editor.Id) => Atom.Atom<Editor.Snapshot | null>
  }
}

const useBoundCommands = (schema: AnyEditorSchema) => {
  const id = BaseReact.useId()
  const editor = BaseReact.useEditor()
  const refresh = useAtomSet(EditorAtom.refresh)

  return {
    setContent: Effect.fn(function* (content: DocumentOf<AnyEditorSchema>, options?: SetContentOptions) {
        if (editor === null) return yield* new EditorUnavailable({ id })
        const decoded = schema.decodeDocument(content)
        if (Either.isLeft(decoded)) return yield* decoded.left
        editor.commands.setContent(decoded.right, options)
        refresh(id)
      }),
    insertContentAt: Effect.fn(function* (
      pos: number,
      content: InsertableNodeOf<AnyEditorSchema> | ReadonlyArray<InsertableNodeOf<AnyEditorSchema>>,
    ) {
        if (editor === null) return yield* new EditorUnavailable({ id })
        const values = Array.isArray(content) ? content : [content]
        for (const value of values) {
          const decoded = schema.decodeNode(value)
          if (Either.isLeft(decoded)) {
            return yield* decoded.left
          }
        }
        const json = Array.isArray(content) ? values : values[0]
        if (!editor.can().insertContentAt(pos, json)) {
          return yield* new InvalidInsertion({ pos, content })
        }
        editor.commands.insertContentAt(pos, json)
        refresh(id)
      }),
  }
}

const shallowEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

const useShallowStable = <A extends Record<string, unknown>>(value: A): A => {
  const ref = React.useRef(value)
  if (!shallowEqual(ref.current, value)) ref.current = value
  return ref.current
}

export const createEditor = <const S extends AnyEditorSchema>(
  schema: S,
): CreatedEditor<S> => {
  const Provider: React.FC<ProviderProps<S>> = ({ id, content, children, ...options }) => {
    const stableOptions = useShallowStable(options)
    const editorOptions = React.useMemo(
      () => ({
        ...stableOptions,
        extensions: schema.extensions,
        content,
      }),
      [content, stableOptions],
    )

    return (
      <BaseReact.Provider id={id} options={editorOptions}>
        {children}
      </BaseReact.Provider>
    )
  }

  const useDocument = () => {
    const id = BaseReact.useId()
    return useAtomValue(React.useMemo(() => documentAtom(id, schema), [id]))
  }
  const useCommands = (): BoundCommands<S> => useBoundCommands(schema)

  return {
    schema,
    Provider,
    Content: BaseReact.Content,
    useId: BaseReact.useId,
    useEditor: BaseReact.useEditor,
    useSnapshot: BaseReact.useSnapshot,
    useState: BaseReact.useState,
    useSubscribe: BaseReact.useSubscribe,
    useDocument,
    useHTML: BaseReact.useHTML,
    useText: BaseReact.useText,
    useCommands,
    atoms: {
      document: (id: Editor.Id) => documentAtom(id, schema),
      html: EditorAtom.html,
      text: EditorAtom.text,
      snapshot: EditorAtom.snapshot,
    },
  }
}
