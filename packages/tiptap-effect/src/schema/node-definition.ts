import type { Schema } from "effect"
import type { ParentConfig, RawCommands } from "@tiptap/core"
import type * as React from "react"

/**
 * Definition of a custom node. Pairs a `Schema.Struct` of attributes with the
 * Tiptap node configuration. Tiptap's `addAttributes` is auto-derived from
 * `attrsSchema`, so the type system and the runtime parser/serialiser come
 * from one source.
 */
export interface NodeDefinition<
  Name extends string,
  Attrs extends Record<string, unknown>,
> {
  readonly name: Name
  readonly attrsSchema: Schema.Schema<Attrs>

  // Tiptap / ProseMirror node config (forwarded to Node.create)
  readonly group?: string
  readonly content?: string
  readonly marks?: string
  readonly inline?: boolean
  readonly atom?: boolean
  readonly selectable?: boolean
  readonly draggable?: boolean
  readonly defining?: boolean
  readonly isolating?: boolean
  readonly code?: boolean
  readonly whitespace?: "pre" | "normal"

  readonly parseHTML?: () => ReadonlyArray<TiptapParseRule>
  readonly renderHTML?: (
    props: { node: TiptapNode; HTMLAttributes: Record<string, unknown> },
  ) => TiptapDOMOutputSpec

  readonly addCommands?: () => Partial<RawCommands>
  readonly extendNodeSchema?: ParentConfig<unknown>

  /**
   * Render this node via a React component. The component reads node attrs
   * via `useNodeViewProps` and dispatches Commands via `useDispatch`.
   *
   * v1 supports leaf nodes only — block nodes with editable content require
   * `contentDOM` wiring that's deferred. Set `atom: true` on your node
   * definition for leaf-style behaviour.
   */
  readonly reactNodeView?: React.FC
}

export interface MarkDefinition<
  Name extends string,
  Attrs extends Record<string, unknown>,
> {
  readonly name: Name
  readonly attrsSchema: Schema.Schema<Attrs>

  readonly inclusive?: boolean
  readonly excludes?: string
  readonly group?: string
  readonly spanning?: boolean
  readonly code?: boolean
  readonly keepOnSplit?: boolean

  readonly parseHTML?: () => ReadonlyArray<TiptapParseRule>
  readonly renderHTML?: (
    props: { mark: TiptapMark; HTMLAttributes: Record<string, unknown> },
  ) => TiptapDOMOutputSpec
}

// Tiptap exports these as type re-exports of ProseMirror's. Keep them as opaque
// here to avoid pulling @tiptap/pm types into the public API surface.
export type TiptapParseRule = unknown
export type TiptapDOMOutputSpec = unknown
export type TiptapNode = unknown
export type TiptapMark = unknown
