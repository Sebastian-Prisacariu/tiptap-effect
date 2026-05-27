import { Atom, Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EditorScope, useEditorSlice } from "tiptap-effect/react"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { createEditor, EditorId } from "tiptap-effect"
import type { EditorId as EditorIdT } from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

const LessonEditor = createEditor(lessonSchema)

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

describe("useEditorSlice — debounceMs overload", () => {
  it("only commits the latest value once per debounce window when 10 keystrokes land inside it", async () => {
    // Build a writable counter atom keyed by EditorId so we can simulate
    // 10 rapid 'keystrokes' by incrementing it. The debounce semantics are
    // independent of where the source value comes from, so a plain state
    // atom isolates the debounce behaviour cleanly.
    const sources = new Map<EditorIdT, Atom.Writable<number, number>>()
    const sourceFor = (id: EditorIdT): Atom.Writable<number, number> => {
      let s = sources.get(id)
      if (!s) {
        s = Atom.make(0)
        sources.set(id, s)
      }
      return s
    }
    const sliceFactory = (id: EditorIdT): Atom.Atom<number> => sourceFor(id)

    const observed: Array<number> = []
    const Probe: React.FC = () => {
      const value = useEditorSlice(sliceFactory, { debounceMs: 100 })
      observed.push(value)
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-debounce")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(observed.length).toBeGreaterThan(0)
    })

    // Fire 10 'keystrokes' rapidly. With debounceMs=100 and ~5ms between
    // updates, none should commit until the burst ends.
    const writable = sourceFor(EditorId("ed-debounce"))
    await act(async () => {
      for (let i = 1; i <= 10; i += 1) {
        registry.set(writable, i)
        await sleep(5)
      }
    })

    // The committed (debounced) value should still be 0 — the burst is
    // shorter than the 100ms window, and each new write resets the timer.
    expect(observed[observed.length - 1]).toBe(0)

    // Wait past the debounce window. The latest value (10) should commit
    // exactly once.
    await act(async () => {
      await sleep(150)
    })

    const finalValue = observed[observed.length - 1]
    expect(finalValue).toBe(10)
  })
})
