import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EditorScope } from "tiptap-effect/react"
import { TiptapView } from "tiptap-effect/react"
import { useRawEditor } from "tiptap-effect/react"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { createEditor, EditorId } from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

const LessonEditor = createEditor(lessonSchema)

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
}

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  cleanup()
  registry.dispose()
})

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
)

describe("<TiptapView /> in <EditorScope>", () => {
  it("renders the editor's contenteditable into the DOM", async () => {
    const { container } = render(
      <Wrapper>
        <EditorScope id={EditorId("ed-react-1")} editor={LessonEditor} spec={{
          defaultContent: validDoc,
        }}>
          <TiptapView />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      const pm = container.querySelector(".ProseMirror")
      expect(pm).not.toBeNull()
    })
  })

  it("two sibling EditorScopes produce two distinct editors", async () => {
    const { container } = render(
      <Wrapper>
        <EditorScope id={EditorId("ed-A")} editor={LessonEditor} spec={{
          defaultContent: validDoc,
        }}>
          <TiptapView />
        </EditorScope>
        <EditorScope id={EditorId("ed-B")} editor={LessonEditor} spec={{
          defaultContent: validDoc,
        }}>
          <TiptapView />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      const editors = container.querySelectorAll(".ProseMirror")
      expect(editors.length).toBe(2)
    })
  })

  it("useRawEditor returns the raw Tiptap editor inside the scope", async () => {
    let capturedEditor: unknown = "not-yet"
    const Probe: React.FC = () => {
      const editor = useRawEditor({ unsafe: true })
      React.useEffect(() => {
        if (editor) capturedEditor = editor
      }, [editor])
      return null
    }

    render(
      <Wrapper>
        <EditorScope id={EditorId("ed-raw")} editor={LessonEditor} spec={{
          defaultContent: validDoc,
        }}>
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(capturedEditor).not.toBe("not-yet")
      expect(capturedEditor).not.toBeNull()
    })
  })

  it("useEditorScope throws outside an EditorScope", () => {
    const BadHook: React.FC = () => {
      useRawEditor({ unsafe: true })
      return null
    }
    // Suppress React's error overlay during test
    const originalError = console.error
    console.error = () => {}
    try {
      expect(() =>
        render(
          <Wrapper>
            <BadHook />
          </Wrapper>,
        ),
      ).toThrow(/inside an <EditorScope>/)
    } finally {
      console.error = originalError
    }
  })
})
