import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Data, Schema } from "effect"

export const DocumentSelectorSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  attrs: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  text: Schema.optional(Schema.String),
  textIncludes: Schema.optional(Schema.String),
  textMatches: Schema.optional(Schema.String),
  nth: Schema.optional(Schema.Number),
})

export type DocumentSelector = typeof DocumentSelectorSchema.Type

export interface DocumentMatch {
  readonly pos: number
  readonly from: number
  readonly to: number
  readonly size: number
  readonly nodeType: string
  readonly attrs: Readonly<Record<string, unknown>>
  readonly text: string
}

export class DocumentSelectorError extends Data.TaggedError("DocumentSelectorError")<{
  readonly selector: DocumentSelector
  readonly message: string
}> {}

const jsonEquals = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const attrsMatch = (
  attrs: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (!expected) return true
  return Object.entries(expected).every(([key, value]) =>
    jsonEquals(attrs[key], value),
  )
}

const textMatches = (text: string, selector: DocumentSelector): boolean => {
  if (selector.text !== undefined && text !== selector.text) return false
  if (selector.textIncludes !== undefined && !text.includes(selector.textIncludes)) {
    return false
  }
  if (selector.textMatches !== undefined && !new RegExp(selector.textMatches).test(text)) {
    return false
  }
  return true
}

const matchesSelector = (
  node: ProseMirrorNode,
  selector: DocumentSelector,
): boolean => {
  if (selector.type !== undefined && node.type.name !== selector.type) return false
  if (!attrsMatch(node.attrs, selector.attrs)) return false
  if (!textMatches(node.textContent, selector)) return false
  return true
}

export const findDocumentMatches = (
  doc: ProseMirrorNode,
  selector: DocumentSelector,
): ReadonlyArray<DocumentMatch> => {
  const matches: Array<DocumentMatch> = []
  doc.descendants((node, pos) => {
    if (matchesSelector(node, selector)) {
      matches.push({
        pos,
        from: pos,
        to: pos + node.nodeSize,
        size: node.nodeSize,
        nodeType: node.type.name,
        attrs: node.attrs,
        text: node.textContent,
      })
    }
    return true
  })
  if (selector.nth === undefined) return matches
  const match = matches[selector.nth]
  return match ? [match] : []
}
