import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ToggleMarkCommand } from "../../src/commands"
import {
  EditorScope,
  TiptapView,
  useDispatch,
  useHistory,
  useRawEditor,
} from "../../src/react"
import { defineEditorSchema } from "../../src/schema/define"
import { BoldMark } from "../../src/schema/marks"
import { DocNode, ParagraphNode, TextNode } from "../../src/schema/nodes"
import { EditorId } from "../../src/types"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

const ToggleBold = ToggleMarkCommand("bold")

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

describe("useDispatch + useHistory", () => {
  it("dispatch toggles bold; history.undo restores", async () => {
    let exposed: {
      dispatch: ReturnType<typeof useDispatch>
      history: ReturnType<typeof useHistory>
      editor: ReturnType<typeof useRawEditor>
    } | null = null

    const Probe: React.FC = () => {
      const dispatch = useDispatch()
      const history = useHistory()
      const editor = useRawEditor({ unsafe: true })
      exposed = { dispatch, history, editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-dispatch")}
          spec={{
            id: EditorId("ed-dispatch"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    // Wait for editor to mount
    await waitFor(() => {
      expect(exposed).not.toBeNull()
      expect(exposed!.editor).not.toBeNull()
    })

    const editor = exposed!.editor!
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 1, to: 4 })

    // Dispatch ToggleBold
    await act(async () => {
      await exposed!.dispatch(ToggleBold, undefined)
    })
    expect(editor.isActive("bold")).toBe(true)

    // Undo
    await act(async () => {
      await exposed!.history.undo()
    })
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(editor.isActive("bold")).toBe(false)

    // Redo
    await act(async () => {
      await exposed!.history.redo()
    })
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(editor.isActive("bold")).toBe(true)
  })

  it("dispatch rejects before the editor is ready", async () => {
    // This test is a bit awkward — by the time the React tree commits,
    // the atom is already resolved. We verify the runtime path of the
    // guard by manually calling dispatch right after render before any
    // act(). In practice we'll see Success quickly.
    let exposed: ReturnType<typeof useDispatch> | null = null
    const Probe: React.FC = () => {
      exposed = useDispatch()
      return null
    }
    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-rej")}
          spec={{
            id: EditorId("ed-rej"),
            schema: lessonSchema,
            defaultContent: { type: "doc", content: [{ type: "callout" }] }, // invalid
          }}
        >
          <Probe />
        </EditorScope>
      </Wrapper>,
    )
    await waitFor(() => {
      expect(exposed).not.toBeNull()
    })
    // Schema decode failure means the result is Failure, not Success — dispatch should reject
    await expect(exposed!(ToggleBold, undefined)).rejects.toBeDefined()
  })
})
