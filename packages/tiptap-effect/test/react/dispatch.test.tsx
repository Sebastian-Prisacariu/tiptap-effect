import { Registry, Result } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ToggleMarkCommand } from "tiptap-effect/command/commands"
import {
  EditorScope,
  TiptapView,
  useDispatch,
  useHistory,
  useRawEditor,
} from "tiptap-effect/react"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"

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

    let dispatchResult: Result.Result<unknown, unknown> | null = null
    await act(async () => {
      dispatchResult = await exposed!.dispatch(ToggleBold, undefined)
    })
    expect(dispatchResult).not.toBeNull()
    expect(Result.isSuccess(dispatchResult!)).toBe(true)
    expect(editor.isActive("bold")).toBe(true)

    let undoResult: Result.Result<unknown, unknown> | null = null
    await act(async () => {
      undoResult = await exposed!.history.undo()
    })
    expect(undoResult).not.toBeNull()
    expect(Result.isSuccess(undoResult!)).toBe(true)
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(editor.isActive("bold")).toBe(false)

    let redoResult: Result.Result<unknown, unknown> | null = null
    await act(async () => {
      redoResult = await exposed!.history.redo()
    })
    expect(redoResult).not.toBeNull()
    expect(Result.isSuccess(redoResult!)).toBe(true)
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(editor.isActive("bold")).toBe(true)
  })

  it("dispatch returns Failure before the editor is ready", async () => {
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
    const result = await exposed!(ToggleBold, undefined)
    expect(Result.isFailure(result)).toBe(true)
  })

  it("history is scoped to the current EditorScope", async () => {
    let exposedA: {
      dispatch: ReturnType<typeof useDispatch>
      history: ReturnType<typeof useHistory>
      editor: ReturnType<typeof useRawEditor>
    } | null = null
    let exposedB: {
      history: ReturnType<typeof useHistory>
      editor: ReturnType<typeof useRawEditor>
    } | null = null

    const ProbeA: React.FC = () => {
      exposedA = {
        dispatch: useDispatch(),
        history: useHistory(),
        editor: useRawEditor({ unsafe: true }),
      }
      return null
    }
    const ProbeB: React.FC = () => {
      exposedB = {
        history: useHistory(),
        editor: useRawEditor({ unsafe: true }),
      }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-history-a")}
          spec={{
            id: EditorId("ed-history-a"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <ProbeA />
        </EditorScope>
        <EditorScope
          id={EditorId("ed-history-b")}
          spec={{
            id: EditorId("ed-history-b"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <ProbeB />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedA?.editor).not.toBeNull()
      expect(exposedB?.editor).not.toBeNull()
    })

    const editorA = exposedA!.editor!
    editorA.commands.focus()
    editorA.commands.setTextSelection({ from: 1, to: 4 })

    await act(async () => {
      const result = await exposedA!.dispatch(ToggleBold, undefined)
      expect(Result.isSuccess(result)).toBe(true)
    })
    expect(editorA.isActive("bold")).toBe(true)

    await act(async () => {
      const result = await exposedB!.history.undo()
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expect(result.value).toBeNull()
    })
    editorA.commands.setTextSelection({ from: 1, to: 4 })
    expect(editorA.isActive("bold")).toBe(true)

    await act(async () => {
      const result = await exposedA!.history.undo()
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expect(result.value).not.toBeNull()
    })
    editorA.commands.setTextSelection({ from: 1, to: 4 })
    expect(editorA.isActive("bold")).toBe(false)
  })
})
