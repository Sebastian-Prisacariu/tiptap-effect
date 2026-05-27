import { Registry } from "@effect-atom/atom"
import { Result } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { Effect } from "effect"
import * as React from "react"
import {
  EditorId,
  EditorScope,
  Marks,
  Nodes,
  TiptapView,
  createEditor,
  defineEditorSchema,
  docAtom,
  isActiveAtom,
  selectedTextAtom,
  useDispatch,
  useEditorSlice,
  useHistory,
} from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: {
    doc: Nodes.DocNode,
    paragraph: Nodes.ParagraphNode,
    heading: Nodes.HeadingNode,
    text: Nodes.TextNode,
  },
  marks: {
    bold: Marks.BoldMark,
    italic: Marks.ItalicMark,
  },
})

const LessonEditor = createEditor(lessonSchema)

const defaultContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello from tiptap-effect" }],
    },
  ],
}

const editorId = EditorId("basic-vite-editor")

const Toolbar = () => {
  const dispatch = useDispatch()
  const history = useHistory()
  const boldActive = useEditorSlice((id) => isActiveAtom(id, "bold"))
  const selectedText = useEditorSlice(selectedTextAtom)
  const toggleBold = Effect.gen(function* () {
    yield* dispatch(LessonEditor.commands.focus, undefined)
    yield* dispatch(LessonEditor.commands.toggleMark("bold"), undefined)
  })

  return (
    <div className="toolbar">
      <button
        type="button"
        data-active={boldActive}
        onClick={() => void Effect.runPromise(toggleBold)}
      >
        Bold
      </button>
      <button type="button" onClick={() => Effect.runPromise(history.undo())}>
        Undo
      </button>
      <span>Selected: {selectedText || "none"}</span>
    </div>
  )
}

const PersistencePreview = () => {
  const doc = useEditorSlice((id) => docAtom(id, LessonEditor.schema), {
    debounceMs: 100,
  })

  if (doc === null) return <pre>No transaction yet.</pre>
  if (!Result.isSuccess(doc)) return <pre>Document failed schema decode.</pre>
  return <pre>{JSON.stringify(doc.value, null, 2)}</pre>
}

export const App = () => {
  const registry = React.useMemo(() => Registry.make(), [])
  const spec = React.useMemo(
    () => ({
      defaultContent,
      onSchemaMismatch: "log" as const,
    }),
    [],
  )

  React.useEffect(() => () => registry.dispose(), [registry])

  return (
    <RegistryContext.Provider value={registry}>
      <EditorScope id={editorId} editor={LessonEditor} spec={spec}>
        <main>
          <h1>tiptap-effect basic Vite example</h1>
          <Toolbar />
          <TiptapView className="editor" />
          <PersistencePreview />
        </main>
      </EditorScope>
    </RegistryContext.Provider>
  )
}
