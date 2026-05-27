import { Atom, Registry } from "@effect-atom/atom"
import { RegistryContext, Result, useAtomValue } from "@effect-atom/atom-react"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { Schema, Effect } from "effect"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEditor, EditorId } from "tiptap-effect"
import {
  EditorScope,
  TiptapView,
  useDispatchPromise,
  useNodeViewProps,
  useRawEditor,
} from "tiptap-effect/react"
import {
  BoldMark,
  DocNode,
  ParagraphNode,
  TextNode,
  defineEditorSchema,
  type NodeDefinition,
} from "tiptap-effect/schema"

interface MentionAttrs extends Record<string, unknown> {
  userId: string
}

const docWithMentions = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "hi " },
        { type: "mention", attrs: { userId: "alice" } },
        { type: "text", text: " and " },
        { type: "mention", attrs: { userId: "bob" } },
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

const makeSchema = (Component: React.FC) => {
  const MentionNode: NodeDefinition<"mention", MentionAttrs> = {
    name: "mention",
    attrsSchema: Schema.Struct({ userId: Schema.String }),
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    reactNodeView: Component,
  }

  return defineEditorSchema({
    nodes: {
      doc: DocNode,
      paragraph: ParagraphNode,
      text: TextNode,
      mention: MentionNode,
    },
    marks: { bold: BoldMark },
  })
}

const mentionPositions = (
  editor: NonNullable<ReturnType<typeof useRawEditor>>,
): ReadonlyArray<{ readonly userId: string; readonly pos: number; readonly size: number }> => {
  const positions: Array<{ userId: string; pos: number; size: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "mention") {
      positions.push({
        userId: node.attrs.userId as string,
        pos,
        size: node.nodeSize,
      })
    }
  })
  return positions
}

describe("NodeView lifecycle", () => {
  it("removing one node unmounts only that NodeView; siblings stay mounted", async () => {
    const live = new Set<string>()
    let exposedEditor: ReturnType<typeof useRawEditor> = null

    const MentionChip: React.FC = () => {
      const { attrs } = useNodeViewProps<MentionAttrs>()
      React.useEffect(() => {
        live.add(attrs.userId)
        return () => {
          live.delete(attrs.userId)
        }
      }, [attrs.userId])
      return <span data-mention-chip={attrs.userId}>@{attrs.userId}</span>
    }

    const Probe: React.FC = () => {
      exposedEditor = useRawEditor({ unsafe: true })
      return null
    }

    const schema = makeSchema(MentionChip)
    const editorKit = createEditor(schema)
    const { container } = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-remove")}
          editor={editorKit}
          spec={{ defaultContent: docWithMentions }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedEditor).not.toBeNull()
      expect(live.has("alice")).toBe(true)
      expect(live.has("bob")).toBe(true)
    })

    const alice = mentionPositions(exposedEditor!).find((pos) => pos.userId === "alice")!
    await act(async () => {
      exposedEditor!.commands.deleteRange({ from: alice.pos, to: alice.pos + alice.size })
    })

    await waitFor(() => {
      expect(live.has("alice")).toBe(false)
      expect(live.has("bob")).toBe(true)
      expect(container.querySelector('[data-mention-chip="alice"]')).toBeNull()
      expect(container.querySelector('[data-mention-chip="bob"]')).not.toBeNull()
    })
  })

  it("unmounts NodeView roots before editor.destroy on registry disposal", async () => {
    const events: Array<string> = []
    let exposedEditor: ReturnType<typeof useRawEditor> = null

    const MentionChip: React.FC = () => {
      const editor = useRawEditor({ unsafe: true })
      const { attrs } = useNodeViewProps<MentionAttrs>()
      React.useEffect(() => () => {
        events.push(`node.cleanup:${attrs.userId}:${editor?.isDestroyed ? "destroyed" : "live"}`)
      }, [attrs.userId, editor])
      return <span data-mention-chip={attrs.userId}>@{attrs.userId}</span>
    }

    const Probe: React.FC = () => {
      exposedEditor = useRawEditor({ unsafe: true })
      return null
    }

    const schema = makeSchema(MentionChip)
    const editorKit = createEditor(schema)
    const rendered = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-dispose")}
          editor={editorKit}
          spec={{ defaultContent: docWithMentions }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedEditor).not.toBeNull()
    })

    const originalDestroy = exposedEditor!.destroy.bind(exposedEditor!)
    vi.spyOn(exposedEditor!, "destroy").mockImplementation(() => {
      events.push("editor.destroy")
      return originalDestroy()
    })

    await act(async () => {
      rendered.unmount()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(events.some((event) => event.startsWith("node.cleanup:"))).toBe(true)
    })
    registry.dispose()

    await waitFor(() => {
      expect(events).toContain("editor.destroy")
      expect(events.some((event) => event.startsWith("node.cleanup:"))).toBe(true)
    })

    const firstNodeCleanup = events.findIndex((event) => event.startsWith("node.cleanup:"))
    const editorDestroy = events.indexOf("editor.destroy")
    expect(firstNodeCleanup).toBeGreaterThanOrEqual(0)
    expect(firstNodeCleanup).toBeLessThan(editorDestroy)
  })

  it("survives StrictMode without leaking live NodeView roots", async () => {
    let liveNodeViews = 0

    const MentionChip: React.FC = () => {
      const { attrs } = useNodeViewProps<MentionAttrs>()
      React.useEffect(() => {
        liveNodeViews += 1
        return () => {
          liveNodeViews -= 1
        }
      }, [])
      return <span data-mention-chip={attrs.userId}>@{attrs.userId}</span>
    }

    const schema = makeSchema(MentionChip)
    const editorKit = createEditor(schema)
    const rendered = render(
      <React.StrictMode>
        <Wrapper>
          <EditorScope
            id={EditorId("ed-nv-strict")}
            editor={editorKit}
            spec={{ defaultContent: docWithMentions }}
          >
            <TiptapView />
          </EditorScope>
        </Wrapper>
      </React.StrictMode>,
    )

    await waitFor(() => {
      expect(rendered.container.querySelectorAll("[data-mention-chip]").length).toBe(2)
      expect(liveNodeViews).toBe(2)
    })

    rendered.unmount()

    await waitFor(() => {
      expect(liveNodeViews).toBe(0)
    })
  })

  it("lets NodeView buttons use normal dispatch hooks", async () => {
    let exposedEditor: ReturnType<typeof useRawEditor> = null

    const MentionChip: React.FC = () => {
      const dispatch = useDispatchPromise()
      const { attrs } = useNodeViewProps<MentionAttrs>()
      return (
        <button
          type="button"
          data-node-view-button={attrs.userId}
          onClick={() => void dispatch(commands.insertText, { text: "!" })}
        >
          @{attrs.userId}
        </button>
      )
    }

    const Probe: React.FC = () => {
      exposedEditor = useRawEditor({ unsafe: true })
      return null
    }

    const schema = makeSchema(MentionChip)
    const editorKit = createEditor(schema)
    const commands = editorKit.commands
    const { container } = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-dispatch")}
          editor={editorKit}
          spec={{ defaultContent: docWithMentions }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedEditor).not.toBeNull()
      expect(container.querySelector('[data-node-view-button="alice"]')).not.toBeNull()
    })

    await act(async () => {
      exposedEditor!.commands.setTextSelection(exposedEditor!.state.doc.content.size - 1)
      fireEvent.click(container.querySelector('[data-node-view-button="alice"]')!)
    })

    await waitFor(() => {
      expect(exposedEditor!.getText()).toContain("!")
    })
  })

  it("supports non-leaf NodeViews with ProseMirror-owned editable contentDOM", async () => {
    interface CalloutAttrs extends Record<string, unknown> {
      kind: string
    }

    const CalloutView: React.FC = () => {
      const { attrs } = useNodeViewProps<CalloutAttrs>()
      return <span data-callout-chrome={attrs.kind}>callout</span>
    }

    const CalloutNode: NodeDefinition<"callout", CalloutAttrs> = {
      name: "callout",
      attrsSchema: Schema.Struct({ kind: Schema.String }),
      group: "block",
      content: "inline*",
      reactNodeView: CalloutView,
    }

    const schema = defineEditorSchema({
      nodes: {
        doc: DocNode,
        text: TextNode,
        callout: CalloutNode,
      },
      marks: {},
    })
    const editorKit = createEditor(schema)

    const docWithCallout = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { kind: "info" },
          content: [{ type: "text", text: "editable child" }],
        },
      ],
    }

    const rendered = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-contentdom")}
          editor={editorKit}
          spec={{ defaultContent: docWithCallout }}
        >
          <TiptapView />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-callout-chrome="info"]')).not.toBeNull()
      expect(rendered.container.textContent).toContain("editable child")
    })
  })
})

describe("NodeView atom sharing", () => {
  it("shares one in-flight Atom.family fetch across matching NodeViews", async () => {
    let fetches = 0
    const userAtom = Atom.family((userId: string) =>
      Atom.make(
        Effect.promise(async () => {
          fetches += 1
          await new Promise((resolve) => setTimeout(resolve, 5))
          return { userId, label: userId.toUpperCase() }
        }),
      ),
    )

    const MentionChip: React.FC = () => {
      const { attrs } = useNodeViewProps<MentionAttrs>()
      const user = useAtomValue(userAtom(attrs.userId))
      return (
        <span data-mention-chip={attrs.userId}>
          {Result.isSuccess(user) ? user.value.label : "loading"}
        </span>
      )
    }

    const schema = makeSchema(MentionChip)
    const editorKit = createEditor(schema)
    const docWithDuplicateUser = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { userId: "alice" } },
            { type: "text", text: " " },
            { type: "mention", attrs: { userId: "alice" } },
          ],
        },
      ],
    }

    const { container } = render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-nv-family")}
          editor={editorKit}
          spec={{ defaultContent: docWithDuplicateUser }}
        >
          <TiptapView />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(container.querySelectorAll('[data-mention-chip="alice"]').length).toBe(2)
      expect(container.textContent).toContain("ALICE")
    })
    expect(fetches).toBe(1)
  })
})
