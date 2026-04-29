import type { JSONContent } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Data, Effect, Schema } from "effect"
import { defineCommand, Reverse } from "../command"
import { CurrentEditor } from "../internal/current-editor"

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

const SelectorPatchOutput = Schema.Struct({
  previousContent: Schema.Unknown,
  count: Schema.Number,
})

const SelectorInput = Schema.Struct({
  selector: DocumentSelectorSchema,
})

const SelectorManyInput = Schema.Struct({
  selector: DocumentSelectorSchema,
  all: Schema.optional(Schema.Boolean),
})

const SelectorAttrsInput = Schema.Struct({
  selector: DocumentSelectorSchema,
  attrs: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  all: Schema.optional(Schema.Boolean),
})

const SelectorInsertInput = Schema.Struct({
  selector: DocumentSelectorSchema,
  content: Schema.Unknown,
  at: Schema.optional(Schema.Literal("before", "after", "start", "end")),
})

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

const selectMatches = (
  doc: ProseMirrorNode,
  selector: DocumentSelector,
  all: boolean | undefined,
): Effect.Effect<ReadonlyArray<DocumentMatch>, DocumentSelectorError> =>
  Effect.sync(() => {
    const matches = findDocumentMatches(doc, selector)
    return all === true ? matches : matches.slice(0, 1)
  }).pipe(
    Effect.flatMap((matches) =>
      matches.length > 0
        ? Effect.succeed(matches)
        : Effect.fail(
            new DocumentSelectorError({
              selector,
              message: "No document nodes matched selector",
            }),
          ),
    ),
  )

const restorePreviousContent = (previousContent: unknown) =>
  Effect.gen(function* () {
    const editor = yield* CurrentEditor
    editor.commands.setContent(previousContent as JSONContent)
  })

export const InsertContentAtMatchCommand = defineCommand({
  op: "tiptap-effect.selector.insert-at-match",
  description: ({ selector, at = "after" }) =>
    `Insert content ${at} selector ${selector.type ?? "*"}`,
  inputSchema: SelectorInsertInput,
  outputSchema: SelectorPatchOutput,
  forward: ({ selector, content, at = "after" }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor
      const previousContent = editor.state.doc.toJSON()
      const matches = yield* selectMatches(editor.state.doc, selector, false)
      const match = matches[0]!
      const pos =
        at === "before" ? match.from
        : at === "after" ? match.to
        : at === "start" ? match.from + 1
        : match.to - 1
      editor.commands.insertContentAt(pos, content as JSONContent | string)
      return { previousContent, count: 1 }
    }),
  reverse: (_input, { previousContent }) =>
    restorePreviousContent(previousContent),
})

export const ReplaceMatchesCommand = defineCommand({
  op: "tiptap-effect.selector.replace",
  description: ({ selector }) => `Replace selector ${selector.type ?? "*"}`,
  inputSchema: Schema.Struct({
    selector: DocumentSelectorSchema,
    content: Schema.Unknown,
    all: Schema.optional(Schema.Boolean),
  }),
  outputSchema: SelectorPatchOutput,
  forward: ({ selector, content, all }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor
      const previousContent = editor.state.doc.toJSON()
      const matches = yield* selectMatches(editor.state.doc, selector, all)
      for (const match of [...matches].sort((a, b) => b.from - a.from)) {
        editor.commands.insertContentAt(
          { from: match.from, to: match.to },
          content as JSONContent | string,
        )
      }
      return { previousContent, count: matches.length }
    }),
  reverse: (_input, { previousContent }) =>
    restorePreviousContent(previousContent),
})

export const DeleteMatchesCommand = defineCommand({
  op: "tiptap-effect.selector.delete",
  description: ({ selector }) => `Delete selector ${selector.type ?? "*"}`,
  inputSchema: SelectorManyInput,
  outputSchema: SelectorPatchOutput,
  forward: ({ selector, all }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor
      const previousContent = editor.state.doc.toJSON()
      const matches = yield* selectMatches(editor.state.doc, selector, all)
      for (const match of [...matches].sort((a, b) => b.from - a.from)) {
        editor.commands.deleteRange({ from: match.from, to: match.to })
      }
      return { previousContent, count: matches.length }
    }),
  reverse: (_input, { previousContent }) =>
    restorePreviousContent(previousContent),
})

export const UpdateNodeAttrsBySelectorCommand = defineCommand({
  op: "tiptap-effect.selector.update-node-attrs",
  description: ({ selector }) => `Update attrs for selector ${selector.type ?? "*"}`,
  inputSchema: SelectorAttrsInput,
  outputSchema: SelectorPatchOutput,
  forward: ({ selector, attrs, all }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor
      const previousContent = editor.state.doc.toJSON()
      const matches = yield* selectMatches(editor.state.doc, selector, all)
      for (const match of matches) {
        const node = editor.state.doc.nodeAt(match.pos)
        if (!node || node.isText) {
          return yield* Effect.fail(
            new DocumentSelectorError({
              selector,
              message: `Cannot update attrs at position ${match.pos}`,
            }),
          )
        }
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(
            match.pos,
            undefined,
            { ...node.attrs, ...attrs },
            node.marks,
          ),
        )
      }
      return { previousContent, count: matches.length }
    }),
  reverse: (_input, { previousContent }) =>
    restorePreviousContent(previousContent),
})

export const FindMatchesCommand = defineCommand({
  op: "tiptap-effect.selector.find",
  description: ({ selector }) => `Find selector ${selector.type ?? "*"}`,
  inputSchema: SelectorInput,
  outputSchema: Schema.Array(
    Schema.Struct({
      pos: Schema.Number,
      from: Schema.Number,
      to: Schema.Number,
      size: Schema.Number,
      nodeType: Schema.String,
      attrs: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      text: Schema.String,
    }),
  ),
  forward: ({ selector }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor
      return findDocumentMatches(editor.state.doc, selector)
    }),
  reverse: Reverse.skipOnUndo,
})
