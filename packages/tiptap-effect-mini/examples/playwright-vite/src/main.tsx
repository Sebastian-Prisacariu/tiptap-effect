import { RegistryProvider, useAtomValue } from "@effect-atom/atom-react"
import * as React from "react"
import { createRoot } from "react-dom/client"
import * as EditorAtom from "tiptap-effect-mini/EditorAtom"
import * as EditorReact from "tiptap-effect-mini/EditorReact"
import { extensions } from "./extensions"
import "./styles.css"

const Inspector = () => {
  const id = EditorReact.useId()
  const text = EditorReact.useText()
  const html = EditorReact.useHTML()
  const mounted = useAtomValue(EditorAtom.isMounted(id))
  const setContent = EditorReact.useSetContent()
  const [editable, setEditable] = EditorReact.useEditable()

  return (
    <aside className="panel">
      <dl>
        <div>
          <dt>Text</dt>
          <dd data-testid="text">{text}</dd>
        </div>
        <div>
          <dt>HTML</dt>
          <dd data-testid="html">{html}</dd>
        </div>
        <div>
          <dt>Mounted</dt>
          <dd data-testid="mounted">{String(mounted)}</dd>
        </div>
        <div>
          <dt>Editable</dt>
          <dd data-testid="editable">{String(editable)}</dd>
        </div>
      </dl>
      <div className="buttons">
        <button type="button" onClick={() => setContent("<p>Updated from hook</p>")}>
          Set content
        </button>
        <button type="button" onClick={() => setEditable(!editable)}>
          Toggle editable
        </button>
      </div>
    </aside>
  )
}

const EditorShell = ({ content }: { readonly content: string }) => {
  const [visible, setVisible] = React.useState(true)

  return (
    <EditorReact.Provider
      id="e2e-editor"
      options={{ extensions: extensions(), content }}
    >
      <main>
        <section className="workspace">
          <div className="toolbar">
            <button type="button" onClick={() => setVisible((_) => !_)}>
              Toggle content
            </button>
          </div>
          {visible ? <EditorReact.Content data-testid="editor-content" /> : null}
        </section>
        <Inspector />
      </main>
    </EditorReact.Provider>
  )
}

const App = () => {
  const [content, setContent] = React.useState("<p>Hello browser</p>")
  return (
    <React.StrictMode>
      <RegistryProvider>
        <button
          className="rebuild"
          type="button"
          onClick={() => setContent("<p>Rebuilt browser</p>")}
        >
          Rebuild editor
        </button>
        <EditorShell content={content} />
      </RegistryProvider>
    </React.StrictMode>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
