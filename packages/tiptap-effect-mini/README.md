# tiptap-effect-mini

A tiny React binding for Tiptap that lets Effect Atom own the editor lifecycle.

It intentionally avoids the richer command/history/document abstractions in
`tiptap-effect`. You get a Tiptap editor instance, React lifecycle wiring,
small selector hooks, and Effect Atom finalization.

## License

MIT. See [LICENSE.md](../../LICENSE.md).

```tsx
import { createEditor, defineMark, defineNode, defineSchema } from "tiptap-effect-mini"

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

const Bold = defineMark("bold", {
  html: "strong",
})

const schema = defineSchema({
  nodes: [Doc, Paragraph, Text],
  marks: [Bold],
})

const Editor = createEditor(schema)

function PlainText() {
  const text = Editor.useText()
  return <span>{text}</span>
}

function SavePreview() {
  const doc = Editor.useDocument()
  return <pre>{JSON.stringify(doc, null, 2)}</pre>
}

export function App() {
  return (
    <Editor.Provider
      content={{
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
      }}
    >
      <Editor.Content />
      <PlainText />
      <SavePreview />
    </Editor.Provider>
  )
}
```
