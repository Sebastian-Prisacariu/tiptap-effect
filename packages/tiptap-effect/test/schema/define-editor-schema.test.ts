import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark, ItalicMark } from "tiptap-effect/schema"
import {
  DocNode,
  HeadingNode,
  ParagraphNode,
  TextNode,
} from "tiptap-effect/schema"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode, heading: HeadingNode },
  marks: { bold: BoldMark, italic: ItalicMark },
})

describe("defineEditorSchema", () => {
  it("generates a Document Schema", () => {
    expect(lessonSchema.Document).toBeDefined()
    expect(lessonSchema.NodeUnion).toBeDefined()
    expect(lessonSchema.MarkUnion).toBeDefined()
  })

  it("generates Tiptap extensions for every node and mark", () => {
    const names = lessonSchema.tiptapExtensions.map((e) => e.name)
    expect(names).toContain("doc")
    expect(names).toContain("paragraph")
    expect(names).toContain("text")
    expect(names).toContain("heading")
    expect(names).toContain("bold")
    expect(names).toContain("italic")
  })

  it("validates a well-formed doc through Document Schema", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Heading" }],
        },
      ],
    }
    const decoded = Schema.decodeUnknownSync(lessonSchema.Document)(doc)
    expect(decoded.type).toBe("doc")
  })

  it("rejects an unknown node type", () => {
    const doc = {
      type: "doc",
      content: [{ type: "callout", content: [] }],
    }
    expect(() => Schema.decodeUnknownSync(lessonSchema.Document)(doc)).toThrow()
  })

  it("rejects an invalid attrs shape", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 99 }, // not 1..6
          content: [{ type: "text", text: "bad" }],
        },
      ],
    }
    expect(() => Schema.decodeUnknownSync(lessonSchema.Document)(doc)).toThrow()
  })

  it("supports nested marks on text nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bold",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    }
    expect(() => Schema.decodeUnknownSync(lessonSchema.Document)(doc)).not.toThrow()
  })
})

describe("defineEditorSchema migrate hook", () => {
  it("runs migrate before decode", () => {
    const oldDoc = { type: "doc", content: [{ type: "callout", content: [] }] }
    const schema = defineEditorSchema({
      nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
      marks: {},
      migrate: (raw: unknown) => {
        if (typeof raw !== "object" || raw === null) return raw
        const r = raw as { type?: string; content?: ReadonlyArray<{ type?: string }> }
        if (r.type === "doc") {
          return {
            ...r,
            content: (r.content ?? []).map((n: { type?: string }) =>
              n.type === "callout" ? { type: "paragraph", content: [] } : n,
            ),
          }
        }
        return raw
      },
    })

    const migrated = schema.migrate(oldDoc)
    expect(() => Schema.decodeUnknownSync(schema.Document)(migrated)).not.toThrow()
  })

  it("default migrate is identity", () => {
    const schema = defineEditorSchema({
      nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
      marks: {},
    })
    const doc = { type: "doc", content: [] }
    expect(schema.migrate(doc)).toBe(doc)
  })
})
