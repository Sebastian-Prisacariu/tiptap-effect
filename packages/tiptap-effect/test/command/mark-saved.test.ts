import { Registry, Result } from "@effect-atom/atom"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, it } from "vitest"
import { CommandExecutor, defineEditorCommands } from "tiptap-effect/command"
import { dirtyAtom } from "tiptap-effect/dirty"
import { makeEditorAtom } from "tiptap-effect/editor"
import { editorRuntime } from "tiptap-effect/runtime"
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

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  registry.dispose()
})

/**
 * Run an Effect through the SAME editorRuntime that dirtyAtom subscribes to —
 * critical for tests that need commands.markSaved's DirtyTracker writes to be
 * visible to dirtyAtom's reads. Mirrors `runOneShotResult` from src/react/hooks.ts.
 */
const runViaRuntime = <A, E>(
  reg: Registry.Registry,
  effect: Effect.Effect<A, E, CommandExecutor>,
): Promise<A> => {
  const oneShot = editorRuntime.atom(effect)
  return new Promise<A>((resolve, reject) => {
    const tryResolve = (r: Result.Result<A, E>) => {
      if (Result.isSuccess(r)) {
        unsub()
        resolve(r.value)
        return true
      }
      if (Result.isFailure(r)) {
        unsub()
        reject(r.cause as unknown)
        return true
      }
      return false
    }
    const unsub = reg.subscribe(oneShot, tryResolve)
    if (tryResolve(reg.get(oneShot))) return
  })
}

const waitForDirty = (
  reg: Registry.Registry,
  atom: ReturnType<typeof dirtyAtom>,
  expected: boolean,
  timeoutMs = 1000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now()
    const check = (r: Result.Result<boolean, never>) => {
      if (Result.isSuccess(r) && r.value === expected) {
        unsub()
        resolve()
        return true
      }
      if (Date.now() - start > timeoutMs) {
        unsub()
        reject(
          new Error(
            `dirtyAtom did not reach ${expected} within ${timeoutMs}ms (last=${
              Result.isSuccess(r) ? String(r.value) : "no-value"
            })`,
          ),
        )
        return true
      }
      return false
    }
    const unsub = reg.subscribe(atom, check)
    check(reg.get(atom))
  })

describe("commands.markSaved + dirtyAtom", () => {
  it("dispatching MarkSaved flips dirtyAtom from true → false; subsequent typing flips it back to true", async () => {
    const id = EditorId("ed-mark-saved-1")
    const editorAtom = makeEditorAtom({ id, schema: lessonSchema, defaultContent: validDoc })
    const _keepEditor = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)
    const editor = handle._internal.editor
    handle.mount(document.createElement("div"))
    editor.commands.setTextSelection(1)

    const dirty = dirtyAtom(id)
    const _keepDirty = registry.subscribe(dirty, () => {})

    const Save = commands.markSaved(id)

    // First, type something so the transactionBus emits and the merged
    // dirty stream observes a current doc snapshot.
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.insertText, { text: "X" })
      }),
    )
    await waitForDirty(registry, dirty, true)

    // Dispatch MarkSaved → dirty flips to false
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, Save, undefined)
      }) as Effect.Effect<unknown, unknown, CommandExecutor>,
    )
    await waitForDirty(registry, dirty, false)

    // Type another character → dirty flips back to true
    await runViaRuntime(
      registry,
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.run(editor, commands.insertText, { text: "Y" })
      }),
    )
    await waitForDirty(registry, dirty, true)

    void _keepEditor
    void _keepDirty
  })
})
