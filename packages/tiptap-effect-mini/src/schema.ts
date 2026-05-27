import { Atom, Result } from "@effect-atom/atom"
import {
  getSchemaByResolvedExtensions,
  Mark as TiptapMarkExt,
  Node as TiptapNodeExt,
  type Extensions,
} from "@tiptap/core"
import { Node as ProseMirrorNode, type Schema as ProseMirrorSchema } from "@tiptap/pm/model"
import { Data, Effect, Either, Schema, SchemaAST } from "effect"
import * as EditorAtom from "./EditorAtom"
import type * as Editor from "./Editor"

type EmptyAttrs = Record<string, never>
type ErasedAttrs = Record<string, unknown>
type ErasedAttrsSchema = Schema.Schema<ErasedAttrs>

export class InvalidDocument extends Data.TaggedError("InvalidDocument")<{
  readonly cause: unknown
}> {}

export class InvalidNode extends Data.TaggedError("InvalidNode")<{
  readonly cause: unknown
}> {}

export class InvalidMark extends Data.TaggedError("InvalidMark")<{
  readonly cause: unknown
}> {}

export class EditorUnavailable extends Data.TaggedError("EditorUnavailable")<{
  readonly id: Editor.Id
}> {}

export class InvalidInsertion extends Data.TaggedError("InvalidInsertion")<{
  readonly pos: number
  readonly content: unknown
}> {}

export type TypedEditorError =
  | InvalidDocument
  | InvalidNode
  | InvalidMark
  | EditorUnavailable
  | InvalidInsertion

export class NodeDefinition<
  Name extends string,
  Attrs extends Record<string, unknown>,
> extends Data.TaggedClass("NodeDefinition")<{
  readonly name: Name
  readonly attrsSchema: Schema.Schema<Attrs>
  readonly topNode?: boolean
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
  readonly parseHTML?: () => ReadonlyArray<unknown>
  readonly renderHTML?: (props: {
    readonly node: unknown
    readonly HTMLAttributes: Record<string, unknown>
  }) => unknown
}> {}

export class MarkDefinition<
  Name extends string,
  Attrs extends Record<string, unknown>,
> extends Data.TaggedClass("MarkDefinition")<{
  readonly name: Name
  readonly attrsSchema: Schema.Schema<Attrs>
  readonly inclusive?: boolean
  readonly excludes?: string
  readonly group?: string
  readonly spanning?: boolean
  readonly code?: boolean
  readonly keepOnSplit?: boolean
  readonly parseHTML?: () => ReadonlyArray<unknown>
  readonly renderHTML?: (props: {
    readonly mark: unknown
    readonly HTMLAttributes: Record<string, unknown>
  }) => unknown
}> {}

type HtmlConfig =
  | string
  | {
      readonly parse?: string | ReadonlyArray<unknown>
      readonly render?: string | ((props: {
        readonly attrs: Record<string, unknown>
        readonly HTMLAttributes: Record<string, unknown>
      }) => unknown)
    }

type NodeConfig<Attrs extends Record<string, unknown>> = {
  readonly attrs: Schema.Schema<Attrs>
  readonly topNode?: boolean
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
  readonly html?: HtmlConfig
  readonly parseHTML?: () => ReadonlyArray<unknown>
  readonly renderHTML?: NodeDefinition<string, Attrs>["renderHTML"]
}

type NodeConfigWithoutAttrs = Omit<NodeConfig<EmptyAttrs>, "attrs"> & {
  readonly attrs?: undefined
}

type MarkConfig<Attrs extends Record<string, unknown>> = {
  readonly attrs: Schema.Schema<Attrs>
  readonly inclusive?: boolean
  readonly excludes?: string
  readonly group?: string
  readonly spanning?: boolean
  readonly code?: boolean
  readonly keepOnSplit?: boolean
  readonly html?: HtmlConfig
  readonly parseHTML?: () => ReadonlyArray<unknown>
  readonly renderHTML?: MarkDefinition<string, Attrs>["renderHTML"]
}

type MarkConfigWithoutAttrs = Omit<MarkConfig<EmptyAttrs>, "attrs"> & {
  readonly attrs?: undefined
}

const EmptyAttrsSchema = Schema.Struct({})

const htmlParse = (html: HtmlConfig | undefined): (() => ReadonlyArray<unknown>) | undefined => {
  if (html === undefined) return undefined
  if (typeof html === "string") return () => [{ tag: html }]
  if (html.parse === undefined) return undefined
  if (typeof html.parse === "string") return () => [{ tag: html.parse }]
  const parse = html.parse
  return () => parse
}

const htmlRender = (
  html: HtmlConfig | undefined,
): ((props: {
  readonly node?: unknown
  readonly mark?: unknown
  readonly HTMLAttributes: Record<string, unknown>
}) => unknown) | undefined => {
  if (html === undefined) return undefined
  const render = typeof html === "string" ? html : html.render
  if (render === undefined) return undefined
  if (typeof render === "string") {
    return ({ HTMLAttributes }) => [render, HTMLAttributes, 0]
  }
  return ({ HTMLAttributes, node, mark }) =>
    render({
      attrs: ((node ?? mark) as { attrs?: Record<string, unknown> } | undefined)?.attrs ?? {},
      HTMLAttributes,
    })
}

export function defineNode<const Name extends string>(
  name: Name,
  config?: NodeConfigWithoutAttrs,
): NodeDefinition<Name, EmptyAttrs>
export function defineNode<
  const Name extends string,
  Attrs extends Record<string, unknown>,
>(
  name: Name,
  config: NodeConfig<Attrs>,
): NodeDefinition<Name, Attrs>
export function defineNode<
  const Name extends string,
  Attrs extends Record<string, unknown>,
>(
  name: Name,
  config: NodeConfig<Attrs> | NodeConfigWithoutAttrs = {},
): NodeDefinition<Name, Attrs> | NodeDefinition<Name, EmptyAttrs> {
  const common = {
    name,
    topNode: config.topNode,
    group: config.group,
    content: config.content,
    marks: config.marks,
    inline: config.inline,
    atom: config.atom,
    selectable: config.selectable,
    draggable: config.draggable,
    defining: config.defining,
    isolating: config.isolating,
    code: config.code,
    whitespace: config.whitespace,
    parseHTML: config.parseHTML ?? htmlParse(config.html),
    renderHTML: config.renderHTML ?? htmlRender(config.html),
  }
  if (config.attrs !== undefined) {
    return new NodeDefinition({
      ...common,
      attrsSchema: config.attrs,
    })
  }
  return new NodeDefinition({
    ...common,
    attrsSchema: EmptyAttrsSchema,
  })
}

export function defineMark<const Name extends string>(
  name: Name,
  config?: MarkConfigWithoutAttrs,
): MarkDefinition<Name, EmptyAttrs>
export function defineMark<
  const Name extends string,
  Attrs extends Record<string, unknown>,
>(
  name: Name,
  config: MarkConfig<Attrs>,
): MarkDefinition<Name, Attrs>
export function defineMark<
  const Name extends string,
  Attrs extends Record<string, unknown>,
>(
  name: Name,
  config: MarkConfig<Attrs> | MarkConfigWithoutAttrs = {},
): MarkDefinition<Name, Attrs> | MarkDefinition<Name, EmptyAttrs> {
  const common = {
    name,
    inclusive: config.inclusive,
    excludes: config.excludes,
    group: config.group,
    spanning: config.spanning,
    code: config.code,
    keepOnSplit: config.keepOnSplit,
    parseHTML: config.parseHTML ?? htmlParse(config.html),
    renderHTML: config.renderHTML ?? htmlRender(config.html),
  }
  if (config.attrs !== undefined) {
    return new MarkDefinition({
      ...common,
      attrsSchema: config.attrs,
    })
  }
  return new MarkDefinition({
    ...common,
    attrsSchema: EmptyAttrsSchema,
  })
}

export type MarkJSON<Name extends string = string, Attrs = Record<string, unknown>> = {
  readonly type: Name
  readonly attrs?: Attrs
}

export type NodeJSON<
  Name extends string = string,
  Attrs = Record<string, unknown>,
  Child = unknown,
  Mark = unknown,
> = {
  readonly type: Name
  readonly attrs?: Attrs
  readonly content?: Array<Child>
  readonly text?: string
  readonly marks?: Array<Mark>
}

type MarkUnionFor<M extends readonly MarkDefinition<string, any>[]> =
  M[number] extends infer Def
    ? Def extends MarkDefinition<infer Name, infer Attrs>
      ? MarkJSON<Name, Attrs>
      : never
    : never

type PrevDepth = [never, 0, 1, 2, 3, 4, 5, 6]
type DefaultDepth = 5

type NodeUnionFor<
  N extends readonly NodeDefinition<string, any>[],
  M extends readonly MarkDefinition<string, any>[],
  Depth extends number = DefaultDepth,
> =
  [Depth] extends [never] ? never
    : N[number] extends infer Def
      ? Def extends NodeDefinition<infer Name, infer Attrs>
        ? NodeJSON<Name, Attrs, NodeUnionFor<N, M, PrevDepth[Depth]>, MarkUnionFor<M>>
        : never
      : never

type DocDefinitionFor<N extends readonly NodeDefinition<string, any>[]> =
  N[number] extends infer Def
    ? Def extends NodeDefinition<infer Name, infer _Attrs>
      ? Name extends "doc"
        ? Def
        : never
      : never
    : never

type DocumentFor<
  N extends readonly NodeDefinition<string, any>[],
  M extends readonly MarkDefinition<string, any>[],
> =
  [DocDefinitionFor<N>] extends [never]
    ? NodeJSON<"doc", Record<string, unknown>, NodeUnionFor<N, M>, MarkUnionFor<M>>
    : DocDefinitionFor<N> extends infer Def
      ? Def extends NodeDefinition<infer Name, infer Attrs>
        ? NodeJSON<Name, Attrs, Exclude<NodeUnionFor<N, M>, NodeJSON<"doc">>, MarkUnionFor<M>>
        : never
      : never

export interface EditorSchema<
  N extends readonly NodeDefinition<string, any>[],
  M extends readonly MarkDefinition<string, any>[],
> {
  readonly nodes: N
  readonly marks: M
  readonly extensions: Extensions
  readonly pmSchema: ProseMirrorSchema
  readonly Node: Schema.Schema<NodeUnionFor<N, M>>
  readonly Mark: Schema.Schema<MarkUnionFor<M>>
  readonly Document: Schema.Schema<DocumentFor<N, M>>
  readonly decodeNode: (value: unknown) => Either.Either<NodeUnionFor<N, M>, InvalidNode>
  readonly decodeMark: (value: unknown) => Either.Either<MarkUnionFor<M>, InvalidMark>
  readonly decodeDocument: (value: unknown) => Either.Either<DocumentFor<N, M>, InvalidDocument>
}

export type AnyEditorSchema = EditorSchema<
  readonly NodeDefinition<string, any>[],
  readonly MarkDefinition<string, any>[]
>

export type DocumentOf<S extends AnyEditorSchema> = S["Document"]["Type"]

export type NodeOf<S extends AnyEditorSchema> = S["Node"]["Type"]

export type MarkOf<S extends AnyEditorSchema> = S["Mark"]["Type"]

const drillToInner = (ast: SchemaAST.AST): SchemaAST.AST => {
  let current = ast
  while (true) {
    if (SchemaAST.isRefinement(current)) {
      current = current.from
      continue
    }
    if (SchemaAST.isTransformation(current)) {
      current = current.to
      continue
    }
    if (SchemaAST.isUnion(current)) {
      const nonUndefined = current.types.find((type) => !SchemaAST.isUndefinedKeyword(type))
      if (nonUndefined) {
        current = nonUndefined
        continue
      }
    }
    return current
  }
}

const stringifyAttr = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

const parseAttr = (raw: string, ast: SchemaAST.AST): unknown => {
  if (SchemaAST.isStringKeyword(ast)) return raw
  if (SchemaAST.isNumberKeyword(ast)) {
    const parsed = Number(raw)
    return Number.isNaN(parsed) ? raw : parsed
  }
  if (SchemaAST.isBooleanKeyword(ast)) return raw === "true"
  if (SchemaAST.isLiteral(ast)) {
    if (typeof ast.literal === "number") return Number(raw)
    if (typeof ast.literal === "boolean") return raw === "true"
    return raw
  }
  const parsed = Effect.runSyncExit(Effect.try(() => JSON.parse(raw)))
  return parsed._tag === "Success" ? parsed.value : raw
}

const attrsFromSchema = (
  schema: ErasedAttrsSchema,
): Record<string, unknown> => {
  let ast = schema.ast
  while (SchemaAST.isTransformation(ast)) ast = ast.from
  if (!SchemaAST.isTypeLiteral(ast)) return {}

  const decoded = Schema.decodeUnknownEither(schema)({})
  const defaults: Record<string, unknown> = Either.isRight(decoded) ? decoded.right : {}
  const attrs: Record<string, unknown> = {}

  for (const prop of ast.propertySignatures) {
    const key = String(prop.name)
    const inner = drillToInner(prop.type)
    const attr = `data-${key}`
    attrs[key] = {
      default: defaults[key],
      parseHTML: (element: HTMLElement) => {
        const raw = element.getAttribute(attr)
        return raw === null ? undefined : parseAttr(raw, inner)
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[key]
        return value === undefined || value === null ? {} : { [attr]: stringifyAttr(value) }
      },
    }
  }
  return attrs
}

const buildNode = (def: NodeDefinition<string, any>) => {
  const config: Record<string, unknown> = {
    name: def.name,
    addAttributes: () => attrsFromSchema(def.attrsSchema),
  }
  for (const key of [
    "topNode",
    "group",
    "content",
    "marks",
    "inline",
    "atom",
    "selectable",
    "draggable",
    "defining",
    "isolating",
    "code",
    "whitespace",
    "parseHTML",
    "renderHTML",
  ] as const) {
    if (def[key] !== undefined) config[key] = def[key]
  }
  return TiptapNodeExt.create(config)
}

const buildMark = (def: MarkDefinition<string, any>) => {
  const config: Record<string, unknown> = {
    name: def.name,
    addAttributes: () => attrsFromSchema(def.attrsSchema),
  }
  for (const key of [
    "inclusive",
    "excludes",
    "group",
    "spanning",
    "code",
    "keepOnSplit",
    "parseHTML",
    "renderHTML",
  ] as const) {
    if (def[key] !== undefined) config[key] = def[key]
  }
  return TiptapMarkExt.create(config)
}

const validateDocument = (pmSchema: ProseMirrorSchema, value: unknown): boolean => {
  const checked = Effect.runSyncExit(Effect.try(() => {
    const node = ProseMirrorNode.fromJSON(pmSchema, value)
    if (node.type !== pmSchema.topNodeType) {
      return false
    }
    node.check()
    return true
  }))
  return checked._tag === "Success" ? checked.value : false
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const attrsAreValid = (
  schema: Schema.Schema<Record<string, unknown>>,
  attrs: unknown,
): boolean => {
  const value = attrs === undefined ? {} : attrs
  return Either.isRight(Schema.decodeUnknownEither(schema)(value))
}

export function defineSchema<
  const N extends readonly NodeDefinition<string, any>[],
>(spec: {
  readonly nodes: N
}): EditorSchema<N, readonly []>
export function defineSchema<
  const N extends readonly NodeDefinition<string, any>[],
  const M extends readonly MarkDefinition<string, any>[],
>(spec: {
  readonly nodes: N
  readonly marks: M
}): EditorSchema<N, M>
export function defineSchema<
  const N extends readonly NodeDefinition<string, any>[],
  const M extends readonly MarkDefinition<string, any>[],
>(spec: {
  readonly nodes: N
  readonly marks?: M
}): EditorSchema<N, M | readonly []> {
  const marks = spec.marks ?? []
  const nodeDefs = spec.nodes
  const markDefs = marks

  const extensions = [...nodeDefs.map(buildNode), ...markDefs.map(buildMark)]
  const pmSchema = getSchemaByResolvedExtensions(extensions)

  const isMark = (value: unknown): value is MarkUnionFor<M> => {
    if (!isRecord(value) || typeof value["type"] !== "string") return false
    const def = markDefs.find((mark) => mark.name === value["type"])
    return def !== undefined && attrsAreValid(def.attrsSchema, value["attrs"])
  }

  const isNode = (value: unknown): value is NodeUnionFor<N, M> => {
    if (!isRecord(value) || typeof value["type"] !== "string") return false
    const def = nodeDefs.find((node) => node.name === value["type"])
    if (def === undefined) return false
    if (!attrsAreValid(def.attrsSchema, value["attrs"])) return false
    if (value["text"] !== undefined && typeof value["text"] !== "string") return false
    if (value["marks"] !== undefined) {
      if (!Array.isArray(value["marks"]) || !value["marks"].every(isMark)) return false
    }
    if (value["content"] !== undefined) {
      if (!Array.isArray(value["content"]) || !value["content"].every(isNode)) return false
    }
    return true 
  }

  const Mark = Schema.declare<MarkUnionFor<M>>(isMark)
  const Node = Schema.declare<NodeUnionFor<N, M>>(isNode)
  const Document = Schema.declare<DocumentFor<N, M>>(
    (value): value is DocumentFor<N, M> =>
      isNode(value) && validateDocument(pmSchema, value),
  )

  return {
    nodes: spec.nodes,
    marks,
    extensions,
    pmSchema,
    Node,
    Mark,
    Document,
    decodeNode: (value) =>
      Either.mapLeft(
        Schema.decodeUnknownEither(Node)(value),
        (cause) => new InvalidNode({ cause }),
      ),
    decodeMark: (value) =>
      Either.mapLeft(
        Schema.decodeUnknownEither(Mark)(value),
        (cause) => new InvalidMark({ cause }),
      ),
    decodeDocument: (value) =>
      Either.mapLeft(
        Schema.decodeUnknownEither(Document)(value),
        (cause) => new InvalidDocument({ cause }),
      ),
  }
}

export const documentAtom = <S extends AnyEditorSchema>(
  id: Editor.Id,
  schema: S,
): Atom.Atom<Result.Result<DocumentOf<S>, InvalidDocument> | null> =>
  Atom.map(EditorAtom.json(id), (json): Result.Result<DocumentOf<S>, InvalidDocument> | null => {
    if (json === null) return null
    const decoded: Either.Either<DocumentOf<S>, InvalidDocument> = schema.decodeDocument(json)
    return Either.isRight(decoded)
      ? Result.success(decoded.right)
      : Result.fail(decoded.left)
  })
