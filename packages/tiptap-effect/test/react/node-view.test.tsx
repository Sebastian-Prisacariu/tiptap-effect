import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { cleanup, render, waitFor } from "@testing-library/react"
import { Schema } from "effect"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EditorScope } from "../../src/react/EditorScope"
import { TiptapView } from "../../src/react/TiptapView"
import { useNodeViewProps } from "../../src/react/NodeViewContext"
import { defineEditorSchema } from "../../src/schema/define"
import type { NodeDefinition } from "../../src/schema/node-definition"
import { BoldMark } from "../../src/schema/marks"
import { DocNode, ParagraphNode, TextNode } from "../../src/schema/nodes"
import { EditorId } from "../../src/types"

interface MentionAttrs extends Record<string, unknown> {
  userId: string
}

const MentionChip: React.FC = () => {
  const { attrs } = useNodeViewProps<MentionAttrs>()
  return <span data-mention-chip data-user-id={attrs.userId}>@{attrs.userId}</span>
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
})

afterEach(() => {
  cleanup()
  registry.dispose()
})

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
)

describe("React NodeView (leaf)", () => {
  it("renders a React component as a NodeView for a leaf node", async () => {
    const { container } = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-1")}
          spec={{
            id: EditorId("ed-nv-1"),
            schema: lessonSchema,
            defaultContent: docWithMention,
          }}
        >
          <TiptapView />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      const chip = container.querySelector("[data-mention-chip]")
      expect(chip).not.toBeNull()
      expect(chip!.getAttribute("data-user-id")).toBe("alice")
      expect(chip!.textContent).toBe("@alice")
    })
  })
})
