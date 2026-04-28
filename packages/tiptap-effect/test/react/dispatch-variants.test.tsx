import { Registry, Result } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { Effect } from "effect"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ToggleMarkCommand } from "../../src/commands"
import {
  EditorScope,
  TiptapView,
  useDispatchEffect,
  useDispatchPromise,
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

describe("useDispatchEffect", () => {
  it("returns an Effect that, when run, dispatches the Command and toggles bold", async () => {
    let exposed: {
      dispatchEffect: ReturnType<typeof useDispatchEffect>
      editor: ReturnType<typeof useRawEditor>
    } | null = null

    const Probe: React.FC = () => {
      const dispatchEffect = useDispatchEffect()
      const editor = useRawEditor({ unsafe: true })
      exposed = { dispatchEffect, editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-dispatch-eff")}
          spec={{
            id: EditorId("ed-dispatch-eff"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposed).not.toBeNull()
      expect(exposed!.editor).not.toBeNull()
    })

    const editor = exposed!.editor!
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 1, to: 4 })

    // The effect is composable — run it via Effect.runPromise.
    await act(async () => {
      const program = exposed!.dispatchEffect(ToggleBold, undefined)
      await Effect.runPromise(program)
    })

    expect(editor.isActive("bold")).toBe(true)
  })
})

describe("useDispatchPromise", () => {
  it("returns Promise<Result> instead of throwing", async () => {
    let exposed: {
      dispatchPromise: ReturnType<typeof useDispatchPromise>
      editor: ReturnType<typeof useRawEditor>
    } | null = null

    const Probe: React.FC = () => {
      const dispatchPromise = useDispatchPromise()
      const editor = useRawEditor({ unsafe: true })
      exposed = { dispatchPromise, editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-dispatch-prom")}
          spec={{
            id: EditorId("ed-dispatch-prom"),
            schema: lessonSchema,
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposed).not.toBeNull()
      expect(exposed!.editor).not.toBeNull()
    })

    const editor = exposed!.editor!
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 1, to: 4 })

    let result: Result.Result<unknown, unknown> | null = null
    await act(async () => {
      result = await exposed!.dispatchPromise(ToggleBold, undefined)
    })
    expect(result).not.toBeNull()
    expect(Result.isSuccess(result!)).toBe(true)
    expect(editor.isActive("bold")).toBe(true)
  })
})
