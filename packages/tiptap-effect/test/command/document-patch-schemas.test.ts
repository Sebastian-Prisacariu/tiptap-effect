import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { makeDocumentPatchSchemas } from "../../src/command/internal/document-patch-schemas"
import {
  DocNode,
  HeadingNode,
  ParagraphNode,
  TextNode,
  defineEditorSchema,
} from "tiptap-effect/schema"

const lessonSchema = defineEditorSchema({
  nodes: {
    doc: DocNode,
    paragraph: ParagraphNode,
    heading: HeadingNode,
    text: TextNode,
  },
  marks: {},
})

const schemas = makeDocumentPatchSchemas(lessonSchema)

const isRight = (value: unknown): boolean =>
  Either.isRight(value as Either.Either<unknown, unknown>)

describe("document patch schemas", () => {
  it("derives selector attrs from schema node attrs", () => {
    const valid = Schema.decodeUnknownEither(schemas.inputs.selector)({
      selector: { type: "heading", attrs: { level: 2 } },
    })
    const invalid = Schema.decodeUnknownEither(schemas.inputs.selector)({
      selector: { type: "heading", attrs: { level: 99 } },
    })

    expect(isRight(valid)).toBe(true)
    expect(isRight(invalid)).toBe(false)
  })

  it("rejects attrs on text-only selectors", () => {
    const valid = Schema.decodeUnknownEither(schemas.inputs.selector)({
      selector: { textIncludes: "hello" },
    })
    const invalid = Schema.decodeUnknownEither(schemas.inputs.selector)({
      selector: { textIncludes: "hello", attrs: {} },
    })

    expect(isRight(valid)).toBe(true)
    expect(isRight(invalid)).toBe(false)
  })

  it("rejects full doc nodes as insertable content", () => {
    const valid = Schema.decodeUnknownEither(schemas.inputs.insertContentAt)({
      pos: 1,
      content: { type: "paragraph", content: [{ type: "text", text: "ok" }] },
    })
    const invalid = Schema.decodeUnknownEither(schemas.inputs.insertContentAt)({
      pos: 1,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "nope" }] },
        ],
      },
    })

    expect(isRight(valid)).toBe(true)
    expect(isRight(invalid)).toBe(false)
  })

  it("limits attrs updates to editable node names", () => {
    const valid = Schema.decodeUnknownEither(schemas.inputs.updateAttrsAt)({
      pos: 1,
      type: "heading",
      attrs: { level: 3 },
    })
    const invalidDoc = Schema.decodeUnknownEither(schemas.inputs.updateAttrsAt)({
      pos: 0,
      type: "doc",
      attrs: {},
    })
    const invalidText = Schema.decodeUnknownEither(schemas.inputs.updateBySelector)({
      selector: { type: "text" },
      attrs: {},
    })

    expect(isRight(valid)).toBe(true)
    expect(isRight(invalidDoc)).toBe(false)
    expect(isRight(invalidText)).toBe(false)
  })
})
