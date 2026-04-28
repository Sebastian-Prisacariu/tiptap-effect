import { Registry } from "@effect-atom/atom"
import { Effect, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineEditorCommand, type NotReversibleError, Reverse } from "../../src/command"
import { CommandExecutor } from "../../src/command-executor"
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

const InsertTextCommand = defineEditorCommand({
  op: "test.insert.text",
  description: ({ text }) => `Insert "${text}"`,
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ pos: Schema.Number }),
  apply: (chain, { text }) => chain.insertContent(text),
  reverseSetup: (state, _input) => {
    const s = state as { selection: { from: number } }
    return { pos: s.selection.from }
  },
  applyReverse: (chain, { text }, { pos }) =>
    chain.deleteRange({ from: pos, to: pos + text.length }),
})

const NotReversibleCmd = {
  op: "test.send.email" as const,
  description: () => "Send email",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  forward: () => Effect.succeed({}),
  reverse: Reverse.notReversible,
}

const layer = CommandExecutor.Default

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})

const provideExecutor = <A, E>(eff: Effect.Effect<A, E, CommandExecutor>) =>
  Effect.runPromise(Effect.provide(eff, layer) as Effect.Effect<A, E, never>)

describe("CommandExecutor — run + undo", () => {
  it("runs forward and pushes a record to history", async () => {
    const id = EditorId("ed-cmd-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1) // place caret at start of "abc"

    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        const out = yield* exec.run(editor, InsertTextCommand, { text: "X" })
        expect(out.pos).toBe(1)
      }),
    )

    expect(editor.getText()).toContain("X")
  })

  it("undo runs reverse and removes the last record", async () => {
    const id = EditorId("ed-cmd-2")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)
    const before = editor.getText()

    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, InsertTextCommand, { text: "X" })
        yield* exec.undo(editor)
      }),
    )

    expect(editor.getText()).toBe(before)
  })

  it("notReversible reverse causes undo to fail with NotReversibleError", async () => {
    const id = EditorId("ed-cmd-3")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor

    let caught: NotReversibleError | null = null
    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, NotReversibleCmd, undefined)
        const result = yield* Effect.either(exec.undo(editor))
        if (result._tag === "Left") {
          caught = result.left as NotReversibleError
        }
      }),
    )
    expect(caught).not.toBeNull()
    expect(caught!._tag).toBe("NotReversibleError")
    expect(caught!.op).toBe("test.send.email")
  })

  it("skipOnUndo silently advances to the next entry", async () => {
    const id = EditorId("ed-cmd-4")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)
    const before = editor.getText()

    const SkippableCmd = {
      op: "test.skip" as const,
      description: () => "Skippable",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      forward: () => Effect.succeed({}),
      reverse: Reverse.skipOnUndo,
    }

    await provideExecutor(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, InsertTextCommand, { text: "Y" })
        yield* exec.run(editor, SkippableCmd, undefined)
        // Undo: skipOnUndo silently popped, then InsertText reversed
        yield* exec.undo(editor)
      }),
    )

    expect(editor.getText()).toBe(before)
  })
})
