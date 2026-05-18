import { Mark, Node, type Extensions } from "@tiptap/core"

export const Doc = Node.create({
  name: "doc",
  topNode: true,
  content: "block+",
})

export const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

export const Text = Node.create({
  name: "text",
  group: "inline",
})

export const Bold = Mark.create({
  name: "bold",
  parseHTML: () => [
    { tag: "strong" },
    { tag: "b" },
    { style: "font-weight=bold" },
  ],
  renderHTML: ({ HTMLAttributes }) => ["strong", HTMLAttributes, 0],
})

export const basicExtensions = (): Extensions => [
  Doc,
  Paragraph,
  Text,
  Bold,
]

export const editorOptions = (content = "<p>Hello</p>") => ({
  extensions: basicExtensions(),
  content,
})

