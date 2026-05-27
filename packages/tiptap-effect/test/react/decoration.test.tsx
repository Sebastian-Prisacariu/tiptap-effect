import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import type { EditorState } from "@tiptap/pm/state"
import { DecorationSet } from "@tiptap/pm/view"
import { cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createEditor, EditorId } from "tiptap-effect"
import { EditorScope, TiptapView, reactDecoration } from "tiptap-effect/react"
import {
  BoldMark,
  DocNode,
  ParagraphNode,
  TextNode,
  defineEditorSchema,
} from "tiptap-effect/schema"

const lessonSchema = defineEditorSchema({
  nodes: {
    doc: DocNode,
    paragraph: ParagraphNode,
    text: TextNode,
  },
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

describe("reactDecoration", () => {
  it("renders a React widget decoration through the editor NodeView store", async () => {
    let liveDecorations = 0
    const GhostText: React.FC<{ label: string }> = ({ label }) => {
      React.useEffect(() => {
        liveDecorations += 1
        return () => {
          liveDecorations -= 1
        }
      }, [])
      return <span data-react-decoration>{label}</span>
    }

    const ghost = reactDecoration(GhostText, {
      props: { label: "ghost" },
      className: "ghost-shell",
      attrs: { "data-decoration-shell": "true" },
    })

    const rendered = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-decoration")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
            editorProps: {
              decorations(state: EditorState) {
                return DecorationSet.create(state.doc, [
                  ghost.widget(1, { key: "ghost-1" }),
                ])
              },
            },
          }}
        >
          <TiptapView />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(rendered.container.querySelector("[data-react-decoration]")?.textContent).toBe("ghost")
      expect(rendered.container.querySelector("[data-decoration-shell]")).not.toBeNull()
      expect(rendered.container.querySelector(".ghost-shell")).not.toBeNull()
      expect(liveDecorations).toBe(1)
    })

    rendered.unmount()

    await waitFor(() => {
      expect(liveDecorations).toBe(0)
    })
  })
})
