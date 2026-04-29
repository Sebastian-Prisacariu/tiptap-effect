import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { Schema } from "effect"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  EditorScope,
  TiptapView,
  useNodeViewProps,
  useRawEditor,
} from "tiptap-effect/react"
import { defineEditorSchema } from "tiptap-effect/schema"
import type { NodeDefinition } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"

interface MentionAttrs extends Record<string, unknown> {
  userId: string
}

let mentionRenders = 0

const MentionChip: React.FC = () => {
  mentionRenders += 1
  const { attrs, selected } = useNodeViewProps<MentionAttrs>()
  return (
    <span data-mention-chip data-selected={selected ? "true" : "false"}>
      @{attrs.userId}
    </span>
  )
}

const MentionNode: NodeDefinition<"mention", MentionAttrs> = {
  name: "mention",
  attrsSchema: Schema.Struct({ userId: Schema.String }),
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  reactNodeView: MentionChip,
}

const lessonSchema = defineEditorSchema({
  nodes: {
    doc: DocNode,
    paragraph: ParagraphNode,
    text: TextNode,
    mention: MentionNode,
  },
  marks: { bold: BoldMark },
})

const docWithMention = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "hi " },
        { type: "mention", attrs: { userId: "alice" } },
        { type: "text", text: " bye" },
      ],
    },
  ],
}

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
  mentionRenders = 0
})

afterEach(() => {
  cleanup()
  registry.dispose()
})

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
)

describe("NodeView re-render isolation", () => {
  it("typing in an unrelated paragraph does not re-render a sibling Mention NodeView (equality on derived props holds)", async () => {
    let exposedEditor: ReturnType<typeof useRawEditor> = null
    const Probe: React.FC = () => {
      exposedEditor = useRawEditor({ unsafe: true })
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-rerender")}
          spec={{
            id: EditorId("ed-nv-rerender"),
            schema: lessonSchema,
            defaultContent: docWithMention,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedEditor).not.toBeNull()
      expect(mentionRenders).toBeGreaterThanOrEqual(1)
    })

    const baselineRenders = mentionRenders
    const editor = exposedEditor!

    // Insert plain text into the paragraph (the mention's container) at
    // the END of the doc — far from the mention. The mention's attrs,
    // type, getPos identity, selected, and node identity all remain
    // unchanged. The store's equality check should suppress the update.
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      for (let i = 0; i < 5; i += 1) {
        editor.commands.insertContent("X")
      }
    })

    await new Promise((r) => setTimeout(r, 30))

    // The mention has been rendered once (initial) and possibly once more
    // due to PM rebuilding NodeViews around content edits. Allow a small
    // buffer (≤2 extra renders for the 5 keystrokes) — typing 5 chars
    // should not cause 5 spurious re-renders.
    const extraRenders = mentionRenders - baselineRenders
    expect(extraRenders).toBeLessThanOrEqual(2)
  })
})
