import { Schema } from "effect"
import { Mark as TiptapMarkExt, Node as TiptapNodeExt } from "@tiptap/core"
import type { Extensions } from "@tiptap/core"
import { tiptapAttrsFromSchema } from "./derive.js"
import type { MarkDefinition, NodeDefinition } from "./node-definition.js"

/**
 * A node JSON shape, generic over the `type` literal and `attrs`.
 * This is the shape `editor.getJSON()` produces for a single node.
 */
export type NodeJSON<Name extends string = string, Attrs = Record<string, unknown>> = {
  readonly type: Name
  readonly attrs?: Attrs
  readonly content?: ReadonlyArray<NodeJSON>
  readonly text?: string
  readonly marks?: ReadonlyArray<MarkJSON>
}

export type MarkJSON<Name extends string = string, Attrs = Record<string, unknown>> = {
  readonly type: Name
  readonly attrs?: Attrs
}

type NodeJSONFor<
  N extends Record<string, unknown>,
  M extends Record<string, unknown>,
> = N[keyof N] extends infer Def
  ? Def extends NodeDefinition<infer Name, infer Attrs>
    ? {
        readonly type: Name
        readonly attrs?: Attrs
        readonly content?: ReadonlyArray<NodeJSONFor<N, M>>
        readonly text?: string
        readonly marks?: ReadonlyArray<MarkJSONFor<M>>
      }
    : never
  : never

type MarkJSONFor<M extends Record<string, unknown>> =
  M[keyof M] extends infer Def
    ? Def extends MarkDefinition<infer Name, infer Attrs>
      ? MarkJSON<Name, Attrs>
      : never
    : never

type NodeDefinitionMap<N extends Record<string, unknown>> = {
  readonly [K in keyof N]: N[K] extends NodeDefinition<infer _Name, infer _Attrs>
    ? N[K]
    : never
}

type MarkDefinitionMap<M extends Record<string, unknown>> = {
  readonly [K in keyof M]: M[K] extends MarkDefinition<infer _Name, infer _Attrs>
    ? M[K]
    : never
}

export interface EditorSchema<
  N extends Record<string, unknown>,
  M extends Record<string, unknown>,
> {
  readonly nodes: N
  readonly marks: M
  readonly NodeUnion: Schema.Schema<NodeJSONFor<N, M>>
  readonly MarkUnion: Schema.Schema<MarkJSONFor<M>>
  readonly Document: Schema.Schema<NodeJSONFor<N, M>>
  readonly tiptapExtensions: Extensions
  readonly migrate: (raw: unknown) => unknown
}

type ErasedNodeDefinition = NodeDefinition<string, Record<string, unknown>>
type ErasedMarkDefinition = MarkDefinition<string, Record<string, unknown>>
type ErasedAttrsStruct = Schema.Struct<Schema.Struct.Fields>

const eraseNodeDefinition = (def: unknown): ErasedNodeDefinition =>
  def as unknown as ErasedNodeDefinition

const eraseMarkDefinition = (def: unknown): ErasedMarkDefinition =>
  def as unknown as ErasedMarkDefinition

const buildMarkStruct = <Name extends string, Attrs extends Record<string, unknown>>(
  def: MarkDefinition<Name, Attrs>,
) =>
  Schema.Struct({
    type: Schema.Literal(def.name),
    attrs: Schema.optional(def.attrsSchema),
  })

const buildTiptapNode = <Name extends string, Attrs extends Record<string, unknown>>(
  def: NodeDefinition<Name, Attrs>,
) => {
  const config: Record<string, unknown> = {
    name: def.name,
    addAttributes: () => tiptapAttrsFromSchema(def.attrsSchema as unknown as ErasedAttrsStruct),
  }
  if (def.group !== undefined) config["group"] = def.group
  if (def.content !== undefined) config["content"] = def.content
  if (def.marks !== undefined) config["marks"] = def.marks
  if (def.inline !== undefined) config["inline"] = def.inline
  if (def.atom !== undefined) config["atom"] = def.atom
  if (def.selectable !== undefined) config["selectable"] = def.selectable
  if (def.draggable !== undefined) config["draggable"] = def.draggable
  if (def.defining !== undefined) config["defining"] = def.defining
  if (def.isolating !== undefined) config["isolating"] = def.isolating
  if (def.code !== undefined) config["code"] = def.code
  if (def.whitespace !== undefined) config["whitespace"] = def.whitespace
  if (def.parseHTML !== undefined) config["parseHTML"] = def.parseHTML
  if (def.renderHTML !== undefined) config["renderHTML"] = def.renderHTML
  if (def.addCommands !== undefined) config["addCommands"] = def.addCommands

  // Default parseHTML: tag matching the node name
  if (config["parseHTML"] === undefined) {
    config["parseHTML"] = () => [{ tag: def.name }]
  }
  // Default renderHTML: <name {...attrs}>{children}</name>
  if (config["renderHTML"] === undefined) {
    config["renderHTML"] = ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
      [def.name, HTMLAttributes, 0]
  }

  return TiptapNodeExt.create(config)
}

const buildTiptapMark = <Name extends string, Attrs extends Record<string, unknown>>(
  def: MarkDefinition<Name, Attrs>,
) => {
  const config: Record<string, unknown> = {
    name: def.name,
    addAttributes: () => tiptapAttrsFromSchema(def.attrsSchema as unknown as ErasedAttrsStruct),
  }
  if (def.inclusive !== undefined) config["inclusive"] = def.inclusive
  if (def.excludes !== undefined) config["excludes"] = def.excludes
  if (def.group !== undefined) config["group"] = def.group
  if (def.spanning !== undefined) config["spanning"] = def.spanning
  if (def.code !== undefined) config["code"] = def.code
  if (def.keepOnSplit !== undefined) config["keepOnSplit"] = def.keepOnSplit
  if (def.parseHTML !== undefined) config["parseHTML"] = def.parseHTML
  if (def.renderHTML !== undefined) config["renderHTML"] = def.renderHTML

  if (config["parseHTML"] === undefined) {
    config["parseHTML"] = () => [{ tag: def.name }]
  }
  if (config["renderHTML"] === undefined) {
    config["renderHTML"] = ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
      [def.name, HTMLAttributes, 0]
  }

  return TiptapMarkExt.create(config)
}

/**
 * Declare the schema for an editor. Generates:
 *  - a discriminated-union `Document` Schema for runtime validation,
 *  - a flat list of Tiptap node/mark extensions for runtime use,
 *  - a `migrate` hook that runs before decode.
 *
 * `nodes` and `marks` are records of definitions keyed by their PM name.
 */
export const defineEditorSchema = <
  const N extends Record<string, unknown>,
  const M extends Record<string, unknown>,
>(spec: {
  nodes: N & NodeDefinitionMap<N>
  marks: M & MarkDefinitionMap<M>
  migrate?: (raw: unknown) => unknown
}): EditorSchema<N & NodeDefinitionMap<N>, M & MarkDefinitionMap<M>> => {
  const markDefs = Object.values(spec.marks).map(eraseMarkDefinition)
  const nodeDefs = Object.values(spec.nodes).map(eraseNodeDefinition)

  const markStructs = markDefs.map(buildMarkStruct)
  const MarkUnion = (markStructs.length === 0
    ? Schema.Struct({ type: Schema.String, attrs: Schema.optional(Schema.Unknown) })
    : markStructs.length === 1
      ? markStructs[0]!
      : Schema.Union(...markStructs)) as unknown as Schema.Schema<MarkJSONFor<M>>

  // Recursive node union via Schema.suspend
  const NodeUnion: Schema.Schema<NodeJSONFor<N, M>> = Schema.suspend(() => {
    const nodeStructs = nodeDefs.map((def) =>
      Schema.Struct({
        type: Schema.Literal(def.name),
        attrs: Schema.optional(def.attrsSchema),
        content: Schema.optional(Schema.Array(NodeUnion)),
        text: Schema.optional(Schema.String),
        marks: Schema.optional(Schema.Array(MarkUnion)),
      })
    )
    return (nodeStructs.length === 1
      ? nodeStructs[0]!
      : Schema.Union(...nodeStructs)) as unknown as Schema.Schema<NodeJSONFor<N, M>>
  })

  // Document = the root node (must have type === "doc"); we surface NodeUnion.
  // Consumers validate the doc type themselves; PM enforces structural rules at runtime.
  const Document = NodeUnion

  const tiptapExtensions: Extensions = [
    ...nodeDefs.map(buildTiptapNode),
    ...markDefs.map(buildTiptapMark),
  ]

  const migrate = spec.migrate ?? ((raw: unknown) => raw)

  return {
    nodes: spec.nodes,
    marks: spec.marks,
    NodeUnion,
    MarkUnion,
    Document,
    tiptapExtensions,
    migrate,
  }
}
