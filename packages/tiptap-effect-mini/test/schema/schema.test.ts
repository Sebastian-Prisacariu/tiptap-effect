import { describe, expect, it } from "vitest"
import { Either, Schema } from "effect"
import { defineMark, defineNode, defineSchema } from "../../src/schema"

const Doc = defineNode("doc", {
  topNode: true,
  content: "block+",
})

const Paragraph = defineNode("paragraph", {
  group: "block",
  content: "inline*",
  html: "p",
})

const Text = defineNode("text", {
  group: "inline",
})

const Heading = defineNode("heading", {
  attrs: Schema.Struct({
    level: Schema.Literal(1, 2, 3),
  }),
  group: "block",
  content: "inline*",
})

const Bold = defineMark("bold", {
  html: "strong",
})

const editorSchema = defineSchema({
  nodes: [Doc, Paragraph, Text, Heading],
  marks: [Bold],
})

describe("defineSchema", () => {
  it("creates tagged node and mark definitions", () => {
    expect(Doc._tag).toBe("NodeDefinition")
    expect(Bold._tag).toBe("MarkDefinition")
  })

  it("decodes valid documents", () => {
    const decoded = editorSchema.decodeDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
        },
      ],
    })

    expect(Either.isRight(decoded)).toBe(true)
  })

  it("rejects unknown node types", () => {
    const decoded = editorSchema.decodeNode({
      type: "unknown",
    })

    expect(Either.isLeft(decoded)).toBe(true)
  })

  it("rejects invalid attrs", () => {
    const decoded = editorSchema.decodeNode({
      type: "heading",
      attrs: { level: 9 },
    })

    expect(Either.isLeft(decoded)).toBe(true)
  })

  it("rejects missing required attrs", () => {
    const decoded = editorSchema.decodeNode({
      type: "heading",
    })

    expect(Either.isLeft(decoded)).toBe(true)
  })

  it("rejects documents that fail ProseMirror content rules", () => {
    const decoded = editorSchema.decodeDocument({
      type: "doc",
      content: [{ type: "text", text: "No inline text directly in doc" }],
    })

    expect(Either.isLeft(decoded)).toBe(true)
  })
})
