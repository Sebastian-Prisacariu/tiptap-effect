import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor } from "../../src/command-executor"
import { ToggleMarkCommand } from "../../src/commands"
import { makeEditorAtom } from "../../src/editor"
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

// (runtime + provideExecutor declared above)

// Single ManagedRuntime per test so CommandHistory is shared across all
// dispatch/undo/redo calls. (Effect.provide(layer) builds a fresh layer
// each time, which would mean fresh history on every call.)
let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor, never>

beforeEach(() => {
  runtime = ManagedRuntime.make(CommandExecutor.Default as Layer.Layer<CommandExecutor>)
})

afterEach(async () => {
  await runtime.dispose()
})

const provideExecutor = <A, E>(eff: Effect.Effect<A, E, CommandExecutor>) =>
  runtime.runPromise(eff)

describe("CommandExecutor.redo + ToggleMarkCommand", () => {
  it("dispatching ToggleMarkCommand('bold') toggles bold; undo restores; redo re-applies", async () => {
    const id = EditorId("ed-redo-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 1, to: 4 }) // select "abc"

    expect(editor.isActive("bold")).toBe(false)

    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, ToggleBold, undefined)
      }),
    )
    expect(editor.isActive("bold")).toBe(true)

    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(editor.isActive("bold")).toBe(false)

    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.redo(editor)
      }),
    )
    expect(editor.isActive("bold")).toBe(true)
  })
})
