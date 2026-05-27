import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  EditorScope,
  TiptapView,
  useEditorSubscribe,
  useRawEditor,
} from "tiptap-effect/react"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { selectedTextAtom } from "tiptap-effect/editor"
import { createEditor, EditorId } from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

const LessonEditor = createEditor(lessonSchema)

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abcdef" }] }],
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

describe("useEditorSubscribe", () => {
  it("invokes the handler on slice atom emissions triggered by editor transactions", async () => {
    const handlerCalls: string[] = []
    let editor: ReturnType<typeof useRawEditor> = null

    const Probe: React.FC = () => {
      editor = useRawEditor({ unsafe: true })
      useEditorSubscribe(
        (id) => selectedTextAtom(id),
        (text) => {
          handlerCalls.push(text)
        },
      )
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-subscribe-1")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(editor).not.toBeNull()
    })

    // Manually drive a PM transaction so the per-editor TransactionBus emits
    // and the slice atom recomputes. The handler should fire on the new value.
    await act(async () => {
      editor!.commands.focus()
      editor!.commands.setTextSelection({ from: 1, to: 4 })
      // Yield so the slice atom propagates through Stream + Atom.map
      await new Promise((r) => setTimeout(r, 50))
    })

    // The handler was invoked at least once with the post-selection value.
    expect(handlerCalls.length).toBeGreaterThan(0)
    // The selected text should now be the first three chars
    expect(handlerCalls.includes("abc")).toBe(true)
  })
})
