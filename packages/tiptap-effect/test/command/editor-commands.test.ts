import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands, type EditorRunnableCommand } from "tiptap-effect/command"
import { makeEditorAtom } from "tiptap-effect/editor"
import { defineEditorSchema } from "tiptap-effect/schema"
import { DocNode, HeadingNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, heading: HeadingNode, text: TextNode },
  marks: {},
})

const commands = defineEditorCommands(lessonSchema)

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

const headingDoc = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
}

let registry: Registry.Registry
let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor, never>

beforeEach(() => {
  registry = Registry.make()
  runtime = ManagedRuntime.make(CommandExecutor.Default as Layer.Layer<CommandExecutor>)
})

afterEach(async () => {
  await runtime.dispose()
  registry.dispose()
})

const mountEditor = async (id: string, defaultContent: unknown = validDoc) => {
  const editorAtom = makeEditorAtom({
    id: EditorId(id),
    schema: lessonSchema,
    defaultContent,
  })
  const _keep = registry.subscribe(editorAtom, () => {})
  const handle = await waitForAtom(registry, editorAtom)
  handle.mount(document.createElement("div"))
  return handle._internal.editor
}

const runCommand = <Op extends string, In, Out, Err>(
  editor: Awaited<ReturnType<typeof mountEditor>>,
  command: EditorRunnableCommand<Op, In, Out, Err>,
  input: In,
): Promise<Out> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const exec = yield* CommandExecutor
      return yield* exec.run(editor, command, input)
    }),
  )

const expectRejectTag = async (
  promise: Promise<unknown>,
  tag: string,
): Promise<void> => {
  const hasTag = (value: unknown, seen = new Set<object>()): boolean => {
    if (value === null || typeof value !== "object") return false
    if (seen.has(value)) return false
    seen.add(value)
    const record = value as Record<PropertyKey, unknown>
    if (record["_tag"] === tag) return true
    return Reflect.ownKeys(record).some((key) => hasTag(record[key], seen))
  }

  try {
    await promise
  } catch (error) {
    expect(hasTag(error)).toBe(true)
    return
  }
  throw new Error(`Expected promise to reject with ${tag}`)
}

describe("editor commands", () => {
  it("validates full-document setContent input", async () => {
    const editor = await mountEditor("editor-commands-set-content")

    await expectRejectTag(
      runCommand(editor, commands.setContent, {
        content: { type: "paragraph" },
      } as never),
      "CommandValidationError",
    )
  })

  it("allows string insertion and rejects invalid structured insert content", async () => {
    const editor = await mountEditor("editor-commands-insert-content")

    await runCommand(editor, commands.insertContentAt, { pos: 2, content: "X" })
    expect(editor.getText()).toBe("aXbc")

    await expectRejectTag(
      runCommand(editor, commands.insertContentAt, {
        pos: 2,
        content: { type: "unknown" },
      } as never),
      "CommandValidationError",
    )
  })

  it("rejects invalid structured replace content", async () => {
    const editor = await mountEditor("editor-commands-replace-content")

    await expectRejectTag(
      runCommand(editor, commands.replaceRange, {
        from: 2,
        to: 3,
        content: { type: "unknown" },
      } as never),
      "CommandValidationError",
    )
  })

  it("validates typed selector attrs at runtime", async () => {
    const editor = await mountEditor("editor-commands-selector-attrs", headingDoc)

    await expectRejectTag(
      runCommand(editor, commands.findMatches, {
        selector: { type: "heading", attrs: { level: 99 } },
      } as never),
      "CommandValidationError",
    )
  })

  it("fails updateNodeAttrsAt when the node at pos has the wrong type", async () => {
    const editor = await mountEditor("editor-commands-update-wrong-type", headingDoc)
    let headingPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        headingPos = pos
        return false
      }
      return true
    })

    await expectRejectTag(
      runCommand(editor, commands.updateNodeAttrsAt, {
        pos: headingPos,
        type: "paragraph",
        attrs: {},
      }),
      "EditorCommandError",
    )
  })

  it("uses editor commands as the built-in command surface", async () => {
    const editor = await mountEditor("editor-commands-loose-command")
    const nextDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "loose" }] }],
    } as const

    await runCommand(editor, commands.setContent, { content: nextDoc })
    expect(editor.getText()).toBe("loose")
  })
})
