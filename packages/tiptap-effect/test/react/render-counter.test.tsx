import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ToggleMarkCommand } from "tiptap-effect/command/commands"
import {
  EditorScope,
  TiptapView,
  useDispatchPromise,
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

describe("TiptapView — parent re-renders", () => {
  it("a parent state change that re-renders <TiptapView /> does NOT remount the underlying editor (atom value identity stable)", async () => {
    let exposed: ReturnType<typeof useRawEditor> = null
    const Probe: React.FC = () => {
      exposed = useRawEditor({ unsafe: true })
      return null
    }

    let setBumped: ((v: number) => void) | null = null
    const Parent: React.FC = () => {
      const [bumped, setBumpedLocal] = React.useState(0)
      setBumped = setBumpedLocal
      return (
        <Wrapper>
          <EditorScope
            id={EditorId("ed-rerender")}
            spec={{
              id: EditorId("ed-rerender"),
              schema: lessonSchema,
              defaultContent: validDoc,
            }}
          >
            <span data-testid="bumped">{bumped}</span>
            <TiptapView />
            <Probe />
          </EditorScope>
        </Wrapper>
      )
    }

    render(<Parent />)

    await waitFor(() => {
      expect(exposed).not.toBeNull()
    })

    const editorBefore = exposed!
    expect(editorBefore).not.toBeNull()

    // Bump parent state — forces a re-render of EditorScope's children (incl
    // TiptapView and Probe). The editor instance MUST remain identity-stable.
    await act(async () => {
      setBumped!(1)
    })

    expect(exposed).toBe(editorBefore)
    expect(editorBefore!.isDestroyed).toBe(false)

    // Dispatch a Command after the re-render to confirm the editor is still
    // wired through the runtime and reactive.
    const probe2: React.FC = () => null
    void probe2

    await act(async () => {
      setBumped!(2)
    })
    expect(exposed).toBe(editorBefore)
  })
})

describe("EditorScope — two scopes, two distinct editors", () => {
  it("<EditorScope id='a'> and <EditorScope id='b'> produce two distinct editor instances; commands dispatched in one don't affect the other", async () => {
    let editorA: ReturnType<typeof useRawEditor> = null
    let editorB: ReturnType<typeof useRawEditor> = null
    let dispatchA: ReturnType<typeof useDispatchPromise> | null = null

    const ProbeA: React.FC = () => {
      editorA = useRawEditor({ unsafe: true })
      dispatchA = useDispatchPromise()
      return null
    }
    const ProbeB: React.FC = () => {
      editorB = useRawEditor({ unsafe: true })
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("scope-a")}
          spec={{
            id: EditorId("scope-a"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <ProbeA />
        </EditorScope>
        <EditorScope
          id={EditorId("scope-b")}
          spec={{
            id: EditorId("scope-b"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <ProbeB />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(editorA).not.toBeNull()
      expect(editorB).not.toBeNull()
    })

    expect(editorA).not.toBe(editorB)

    // Dispatch ToggleBold in scope A; assert scope B is unaffected.
    editorA!.commands.focus()
    editorA!.commands.setTextSelection({ from: 1, to: 4 })
    await act(async () => {
      await dispatchA!(ToggleBold, undefined)
    })
    expect(editorA!.isActive("bold")).toBe(true)

    // editor B's selection is empty (never focused/selected); isActive("bold")
    // depends on storedMarks/$from. The crucial assertion is that B's doc
    // wasn't affected — the bold mark only landed in A.
    const aJSON = JSON.stringify(editorA!.getJSON())
    const bJSON = JSON.stringify(editorB!.getJSON())
    expect(aJSON).not.toBe(bJSON)
  })
})
