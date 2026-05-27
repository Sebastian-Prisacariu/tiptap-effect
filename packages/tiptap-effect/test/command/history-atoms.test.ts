import { Registry, Result } from "@effect-atom/atom"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
import { makeEditorAtom } from "tiptap-effect/editor"
import { redoableAtom, undoableAtom } from "tiptap-effect/command"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})
const commands = defineEditorCommands(lessonSchema)
const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}
const ToggleBold = commands.toggleMark("bold")

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})

const readBool = (r: Result.Result<boolean, never>): boolean | null =>
  Result.isSuccess(r) ? r.value : null

describe("undoableAtom / redoableAtom", () => {
  it("undoableAtom flips false -> true on dispatch -> false on undo", async () => {
    const id = EditorId("ed-undoable")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const undoable = undoableAtom(id)
    const redoable = redoableAtom(id)
    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepUndo = registry.subscribe(undoable, () => {})
    const _keepRedo = registry.subscribe(redoable, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection({ from: 1, to: 4 })

    // Allow streams to subscribe
    await new Promise((r) => setTimeout(r, 20))
    expect(readBool(registry.get(undoable))).toBe(false)

    // Use the registry's CommandExecutor instance (Atom.runtime built it once)
    // so the undoableAtom subscribes to the SAME CommandHistory used here.
    // We call run() through a runtime layered onto the SAME editorRuntime.
    // Simplest path: spawn an atom via editorRuntime.atom — but that's what
    // useDispatch already does. Here in test land we use a one-shot atom.
    const { editorRuntime } = await import("tiptap-effect/runtime")
    const dispatchAtom = editorRuntime.atom(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, ToggleBold, undefined)
      }),
    )
    await waitForAtom(registry, dispatchAtom)
    await new Promise((r) => setTimeout(r, 20))

    expect(readBool(registry.get(undoable))).toBe(true)
    expect(readBool(registry.get(redoable))).toBe(false)

    const undoAtom = editorRuntime.atom(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    await waitForAtom(registry, undoAtom)
    await new Promise((r) => setTimeout(r, 20))

    expect(readBool(registry.get(undoable))).toBe(false)
    expect(readBool(registry.get(redoable))).toBe(true)
  })
})
