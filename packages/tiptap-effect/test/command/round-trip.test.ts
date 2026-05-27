import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
import { CommandHistory } from "tiptap-effect/command"
import { makeEditorAtom } from "tiptap-effect/editor"
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
  content: [{ type: "paragraph", content: [{ type: "text", text: "abcdef" }] }],
}

// Linear-congruential generator (deterministic, seedable). Avoids needing a
// fast-check dependency while still exercising a randomised command sequence.
const lcg = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

let registry: Registry.Registry
let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor | CommandHistory, never>

beforeEach(() => {
  registry = Registry.make()
  runtime = ManagedRuntime.make(
    Layer.merge(CommandExecutor.Default, CommandHistory.Default) as Layer.Layer<
      CommandExecutor | CommandHistory
    >,
  )
})

afterEach(async () => {
  registry.dispose()
  await runtime.dispose()
})

describe("CommandExecutor — round-trip property test", () => {
  it.each([1, 7, 42, 1337, 99999])(
    "seed=%i: N reversible InsertText commands at random positions, then N undos, restores the initial doc JSON",
    async (seed) => {
      const id = EditorId(`ed-roundtrip-${seed}`)
      const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
      const _keep = registry.subscribe(editorAtom, () => {})
      const handle = await waitForAtom(registry, editorAtom)
      const editor = handle._internal.editor
      handle.mount(document.createElement("div"))
      editor.commands.focus()
      editor.commands.setTextSelection(1)

      const initialJSON = JSON.stringify(editor.getJSON())

      const N = 12
      const rand = lcg(seed)

      await runtime.runPromise(
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          for (let i = 0; i < N; i++) {
            // Single-char insert at a random valid position. Adjacent inserts
            // may coalesce; non-adjacent ones must remain separate (the
            // command's `coalesce` returns null for non-adjacent pairs).
            const ch = String.fromCharCode(97 + Math.floor(rand() * 26))
            const docSize = editor.state.doc.content.size
            const pos = Math.max(1, Math.min(docSize, 1 + Math.floor(rand() * docSize)))
            editor.commands.setTextSelection(pos)
            yield* exec.run(editor, commands.insertText, { text: ch })
          }
        }),
      )

      // Capture how many distinct history entries actually landed (some
      // adjacent inserts may have coalesced into one entry).
      const past = await runtime.runPromise(
        Effect.gen(function* () {
          const hist = yield* CommandHistory
          return yield* hist.list(id)
        }),
      )
      expect(past.length).toBeGreaterThan(0)

      // Undo every history entry one at a time.
      await runtime.runPromise(
        Effect.gen(function* () {
          const exec = yield* CommandExecutor
          for (let i = 0; i < past.length; i++) {
            yield* exec.undo(editor)
          }
        }),
      )

      const restoredJSON = JSON.stringify(editor.getJSON())
      expect(restoredJSON).toBe(initialJSON)

      // History should now be empty (everything moved to future)
      const finalPast = await runtime.runPromise(
        Effect.gen(function* () {
          const hist = yield* CommandHistory
          return yield* hist.list(id)
        }),
      )
      expect(finalPast.length).toBe(0)
    },
  )
})
