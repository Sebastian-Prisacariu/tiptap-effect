import { Schema } from "effect"
import type { Either } from "effect"
import type { SetContentOptions } from "@tiptap/core"
import {
  createEditor,
  defineMark,
  defineNode,
  defineSchema,
  type NodeDefinition,
  type DocumentOf,
  type NodeOf,
} from "./index"

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

const schema = defineSchema({
  nodes: [Doc, Paragraph, Text, Heading],
  marks: [Bold],
})

const noMarksSchema = defineSchema({
  nodes: [Doc, Paragraph, Text],
})

const widenedNodes: ReadonlyArray<NodeDefinition<string, any>> = [
  Doc,
  Paragraph,
  Text,
]

const widenedSchema = defineSchema({
  nodes: widenedNodes,
})

const Editor = createEditor(schema)

type LessonDocument = DocumentOf<typeof schema>
type LessonNode = NodeOf<typeof schema>
type InsertableLessonNode = Exclude<LessonNode, { readonly type: "doc" }>
type SchemaDocument = typeof schema.Document.Type
type NoMarksDocument = DocumentOf<typeof noMarksSchema>
type WidenedDocument = DocumentOf<typeof widenedSchema>

const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
    },
  ],
} satisfies LessonDocument

const schemaDoc = doc satisfies SchemaDocument
const decodedDoc = schema.decodeDocument(doc) satisfies Either.Either<
  LessonDocument,
  unknown
>

const noMarksDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
} satisfies NoMarksDocument
const decodedNoMarksDoc = noMarksSchema.decodeDocument(noMarksDoc) satisfies Either.Either<
  NoMarksDocument,
  unknown
>

const widenedDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
} satisfies WidenedDocument
const decodedWidenedDoc = widenedSchema.decodeDocument(widenedDoc) satisfies Either.Either<
  WidenedDocument,
  unknown
>

const heading = {
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text: "Title" }],
} satisfies LessonNode

const badHeading = {
  type: "heading",
  attrs: {
    // @ts-expect-error heading level is schema-limited
    level: 9,
  },
} satisfies LessonNode

const unknownNode = {
  // @ts-expect-error unknown node types are rejected
  type: "unknown",
} satisfies LessonNode

Editor.useCommands satisfies () => {
  readonly setContent: (content: LessonDocument, options?: SetContentOptions) => unknown
  readonly insertContentAt: (
    pos: number,
    content: InsertableLessonNode | ReadonlyArray<InsertableLessonNode>,
  ) => unknown
}

void doc
void schemaDoc
void decodedDoc
void noMarksDoc
void decodedNoMarksDoc
void widenedDoc
void decodedWidenedDoc
void heading
void badHeading
void unknownNode
