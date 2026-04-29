import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, type EditorRunnableCommand } from "tiptap-effect/command"
import {
  DeleteRangeCommand,
  InsertContentAtCommand,
  ReplaceRangeCommand,
  UpdateNodeAttrsCommand,
} from "tiptap-effect/command/commands"
import { makeEditorAtom } from "tiptap-effect/editor"
import { defineEditorSchema } from "tiptap-effect/schema"
import { DocNode, HeadingNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, heading: HeadingNode, text: TextNode },
  marks: {},
})

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
) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const exec = yield* CommandExecutor
      yield* exec.run(editor, command, input)
    }),
  )

const undo = (editor: Awaited<ReturnType<typeof mountEditor>>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const exec = yield* CommandExecutor
      yield* exec.undo(editor)
    }),
  )

describe("position/range content commands", () => {
  it("inserts content at a concrete position and undo restores the doc", async () => {
    const editor = await mountEditor("ed-insert-at")
    const before = editor.getJSON()

    await runCommand(editor, InsertContentAtCommand, { pos: 2, content: "X" })
    expect(editor.getText()).toBe("aXbc")

    await undo(editor)
    expect(editor.getJSON()).toEqual(before)
  })

  it("replaces a concrete range and undo restores the doc", async () => {
    const editor = await mountEditor("ed-replace-range")
    const before = editor.getJSON()

    await runCommand(editor, ReplaceRangeCommand, { from: 2, to: 4, content: "YZ" })
    expect(editor.getText()).toBe("aYZ")

    await undo(editor)
    expect(editor.getJSON()).toEqual(before)
  })

  it("deletes a concrete range and undo restores the doc", async () => {
    const editor = await mountEditor("ed-delete-range")
    const before = editor.getJSON()

    await runCommand(editor, DeleteRangeCommand, { from: 2, to: 4 })
    expect(editor.getText()).toBe("a")

    await undo(editor)
    expect(editor.getJSON()).toEqual(before)
  })

  it("updates node attrs at a concrete position and undo restores the doc", async () => {
    const editor = await mountEditor("ed-update-attrs", headingDoc)
    const before = editor.getJSON()
    let headingPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        headingPos = pos
        return false
      }
      return true
    })

    await runCommand(editor, UpdateNodeAttrsCommand, {
      pos: headingPos,
      attrs: { level: 2 },
    })
    expect(editor.getJSON().content?.[0]?.attrs).toEqual({ level: 2 })

    await undo(editor)
    expect(editor.getJSON()).toEqual(before)
  })
})
