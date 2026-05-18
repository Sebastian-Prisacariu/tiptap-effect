# tiptap-effect-mini

A tiny React binding for Tiptap that lets Effect Atom own the editor lifecycle.

It intentionally avoids the richer command/history/document abstractions in
`tiptap-effect`. You get a Tiptap editor instance, React lifecycle wiring,
small selector hooks, and Effect Atom finalization.

```tsx
import * as EditorReact from "tiptap-effect-mini/EditorReact"
import StarterKit from "@tiptap/starter-kit"

function WordCount() {
  const words = EditorReact.useState(({ editor }) =>
    editor.storage.characterCount.words(),
  )
  return <span>{words}</span>
}

export function App() {
  return (
    <EditorReact.Provider options={{ extensions: [StarterKit], content: "<p>Hello</p>" }}>
      <EditorReact.Content />
      <WordCount />
    </EditorReact.Provider>
  )
}
```
