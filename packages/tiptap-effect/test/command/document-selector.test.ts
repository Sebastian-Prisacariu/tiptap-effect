import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands, type EditorRunnableCommand } from "tiptap-effect/command"
import {
  findDocumentMatches,
} from "tiptap-effect/document"
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

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph", content: [{ type: "text", text: "Alpha body" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Details" }] },
    { type: "paragraph", content: [{ type: "text", text: "Beta body" }] },
  ],
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

const mountEditor = async (id: string) => {
  const editorAtom = makeEditorAtom({
    id: EditorId(id),
    schema: lessonSchema,
    defaultContent: doc,
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

const undo = (editor: Awaited<ReturnType<typeof mountEditor>>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const exec = yield* CommandExecutor
      yield* exec.undo(editor)
    }),
  )

describe("document-native selectors", () => {
  it("findDocumentMatches locates nodes by type, attrs, and text", async () => {
    const editor = await mountEditor("ed-selector-find")

    const headings = findDocumentMatches(editor.state.doc, { type: "heading" })
    expect(headings.map((m) => m.text)).toEqual(["Intro", "Details"])

    const levelTwo = findDocumentMatches(editor.state.doc, {
      type: "heading",
      attrs: { level: 2 },
    })
    expect(levelTwo).toHaveLength(1)
    expect(levelTwo[0]?.text).toBe("Details")

    const body = findDocumentMatches(editor.state.doc, {
      type: "paragraph",
      textIncludes: "Beta",
    })
    expect(body).toHaveLength(1)
    expect(body[0]?.text).toBe("Beta body")
  })

  it("FindMatchesCommand returns serialisable match records", async () => {
    const editor = await mountEditor("ed-selector-command-find")
    const matches = await runCommand(editor, commands.findMatches, {
      selector: { type: "heading" },
    })

    expect(matches).toHaveLength(2)
    expect(matches[0]?.nodeType).toBe("heading")
  })

  it("replaces the first matching node and undo restores the document", async () => {
    const editor = await mountEditor("ed-selector-replace")
    const before = editor.getJSON()

    const result = await runCommand(editor, commands.replaceMatches, {
      selector: { type: "heading", text: "Intro" },
      content: { type: "paragraph", content: [{ type: "text", text: "Replaced" }] },
    })
    expect(result.count).toBe(1)
    expect(editor.getText()).toContain("Replaced")
    expect(editor.getText()).not.toContain("Intro")

    await undo(editor)
    expect(editor.getJSON()).toEqual(before)
  })

  it("deletes all matching nodes and undo restores the document", async () => {
    const editor = await mountEditor("ed-selector-delete")
    const before = editor.getJSON()

    const result = await runCommand(editor, commands.deleteMatches, {
      selector: { type: "paragraph" },
      all: true,
    })
    expect(result.count).toBe(2)
    expect(editor.getText()).not.toContain("Alpha body")
    expect(editor.getText()).not.toContain("Beta body")

    await undo(editor)
    expect(editor.getJSON()).toEqual(before)
  })

  it("updates attrs and inserts relative to a matched node", async () => {
    const editor = await mountEditor("ed-selector-update-insert")

    await runCommand(editor, commands.updateNodeAttrsBySelector, {
      selector: { type: "heading", text: "Details" },
      attrs: { level: 3 },
    })
    const updated = findDocumentMatches(editor.state.doc, {
      type: "heading",
      text: "Details",
    })[0]
    expect(updated?.attrs).toMatchObject({ level: 3 })

    await runCommand(editor, commands.insertContentAtMatch, {
      selector: { type: "heading", text: "Details" },
      at: "after",
      content: { type: "paragraph", content: [{ type: "text", text: "Inserted after details" }] },
    })
    expect(editor.getText()).toContain("Inserted after details")
  })
})
