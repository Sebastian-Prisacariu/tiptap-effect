import { Registry, Result } from "@effect-atom/atom"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor } from "../../src/command-executor"
import { ToggleMarkCommand } from "../../src/commands"
import { makeEditorAtom } from "../../src/editor"
import { redoableAtom, undoableAtom } from "../../src/history-atoms"
import { defineEditorSchema } from "../../src/schema/define"
import { BoldMark } from "../../src/schema/marks"
import { DocNode, ParagraphNode, TextNode } from "../../src/schema/nodes"
import { EditorId } from "../../src/types"
import { waitForAtom } from "../helpers/atom"

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
  registry.dispose()
})

const readBool = (r: Result.Result<boolean, never>): boolean | null =>
  Result.isSuccess(r) ? r.value : null

describe("undoableAtom / redoableAtom", () => {
  it("undoableAtom flips false -> true on dispatch -> false on undo", async () => {
    const id = EditorId("ed-undoable")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const _keepUndo = registry.subscribe(undoableAtom, () => {})
    const _keepRedo = registry.subscribe(redoableAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection({ from: 1, to: 4 })

    // Allow streams to subscribe
    await new Promise((r) => setTimeout(r, 20))
    expect(readBool(registry.get(undoableAtom))).toBe(false)

    // Use the registry's CommandExecutor instance (Atom.runtime built it once)
    // so the undoableAtom subscribes to the SAME CommandHistory used here.
    // We call run() through a runtime layered onto the SAME editorRuntime.
    // Simplest path: spawn an atom via editorRuntime.atom — but that's what
    // useDispatch already does. Here in test land we use a one-shot atom.
    const { editorRuntime } = await import("../../src/runtime")
    const dispatchAtom = editorRuntime.atom(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        return yield* exec.run(editor, ToggleBold, undefined)
      }),
    )
    await waitForAtom(registry, dispatchAtom)
    await new Promise((r) => setTimeout(r, 20))

    expect(readBool(registry.get(undoableAtom))).toBe(true)
    expect(readBool(registry.get(redoableAtom))).toBe(false)

    const undoAtom = editorRuntime.atom(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    await waitForAtom(registry, undoAtom)
    await new Promise((r) => setTimeout(r, 20))

    expect(readBool(registry.get(undoableAtom))).toBe(false)
    expect(readBool(registry.get(redoableAtom))).toBe(true)
  })
})
