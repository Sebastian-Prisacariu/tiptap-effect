import { Registry } from "@effect-atom/atom"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandExecutor, defineEditorCommands, type EditorRunnableCommand } from "tiptap-effect/command"
import type { JSONContent } from "@tiptap/core"
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
const reverseEvents: Array<string> = []
const customCommands = defineEditorCommands(lessonSchema, {
  commands: ({ document }) => ({
    replaceBySelector: document.patch({
      op: "test.replace-by-selector",
      description: () => "Replace by selector",
      inputSchema: document.inputs.selectorReplace,
      select: ({ input }) => ({ selector: input.selector, all: input.all }),
      applyMatch: ({ editor, match, input }) => {
        editor.commands.insertContentAt(
          { from: match.from, to: match.to },
          input.content as JSONContent | string,
        )
      },
    }),
    appendBang: document.patch({
      op: "test.append-bang",
      description: () => "Append bang",
      inputSchema: Schema.Void,
      apply: ({ chain }) => chain.insertContent("!"),
    }),
    insertWithReverseCleanup: document.patch({
      op: "test.insert-with-reverse-cleanup",
      description: () => "Insert with reverse cleanup",
      inputSchema: Schema.Struct({ text: Schema.String }),
      run: ({ editor, input }) =>
        Effect.sync(() => {
          editor.commands.insertContent(input.text)
          return { externalId: `external:${input.text}` }
        }),
      outputSchema: Schema.Struct({
        previousContent: lessonSchema.Document,
        externalId: Schema.String,
      }),
      reverse: ({ output, restorePreviousDocument }) =>
        Effect.gen(function* () {
          yield* restorePreviousDocument()
          reverseEvents.push(output.externalId)
        }),
    }),
    insertWithCustomReverseOnly: document.patch({
      op: "test.insert-with-custom-reverse-only",
      description: () => "Insert with custom reverse only",
      inputSchema: Schema.Struct({ text: Schema.String }),
      run: ({ editor, input }) =>
        Effect.sync(() => {
          editor.commands.insertContent(input.text)
        }),
      reverse: () =>
        Effect.sync(() => {
          reverseEvents.push("custom-only")
        }),
    }),
  }),
})

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

const headingDoc = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
}

const repeatedParagraphDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "one" }] },
    { type: "paragraph", content: [{ type: "text", text: "two" }] },
  ],
}

let registry: Registry.Registry
let runtime: ManagedRuntime.ManagedRuntime<CommandExecutor, never>

beforeEach(() => {
  reverseEvents.length = 0
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

  it("document.patch selector commands return previousContent and count", async () => {
    const editor = await mountEditor("editor-commands-selector-count", repeatedParagraphDoc)
    const before = editor.getJSON()

    const output = await runCommand(editor, commands.deleteMatches, {
      selector: { type: "paragraph" },
      all: true,
    })

    expect(output.previousContent).toEqual(before)
    expect(output.count).toBe(2)
  })

  it("document.patch effect commands preserve extra node attrs output", async () => {
    const editor = await mountEditor("editor-commands-update-attrs-output", headingDoc)
    let headingPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        headingPos = pos
        return false
      }
      return true
    })

    const output = await runCommand(editor, commands.updateNodeAttrsAt, {
      pos: headingPos,
      type: "heading",
      attrs: { level: 2 },
    })

    expect(output.previousContent).toEqual(headingDoc)
    expect(output.previousAttrs).toEqual({ level: 1 })
    expect(output.nodeType).toBe("heading")
  })

  it("custom selector patch can use document.patch and undo restores", async () => {
    const editor = await mountEditor("editor-commands-custom-document-command")
    const before = editor.getJSON()

    await runCommand(editor, customCommands.replaceBySelector, {
      selector: { type: "paragraph", text: "abc" },
      content: {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Replaced" }],
      },
    })
    expect(editor.getText()).toBe("Replaced")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getJSON()).toEqual(before)
  })

  it("custom chain patch can use document.patch and undo restores", async () => {
    const editor = await mountEditor("editor-commands-custom-editor-command")
    const before = editor.getJSON()
    editor.commands.setTextSelection(4)

    await runCommand(editor, customCommands.appendBang, undefined)
    expect(editor.getText()).toBe("abc!")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )
    expect(editor.getJSON()).toEqual(before)
  })

  it("custom effect patch reverse can restore then undo external side effects", async () => {
    const editor = await mountEditor("editor-commands-custom-reverse-cleanup")
    const before = editor.getJSON()
    editor.commands.setTextSelection(4)

    const output = await runCommand(editor, customCommands.insertWithReverseCleanup, {
      text: "!",
    })
    expect(output.externalId).toBe("external:!")
    expect(editor.getText()).toBe("abc!")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )

    expect(editor.getJSON()).toEqual(before)
    expect(reverseEvents).toEqual(["external:!"])
  })

  it("custom effect patch reverse can intentionally replace document restore", async () => {
    const editor = await mountEditor("editor-commands-custom-reverse-only")
    editor.commands.setTextSelection(4)

    await runCommand(editor, customCommands.insertWithCustomReverseOnly, {
      text: "!",
    })
    expect(editor.getText()).toBe("abc!")

    await runtime.runPromise(
      Effect.gen(function* () {
        const exec = yield* CommandExecutor
        yield* exec.undo(editor)
      }),
    )

    expect(editor.getText()).toBe("abc!")
    expect(reverseEvents).toEqual(["custom-only"])
  })

  it("custom document command validates selector attrs at runtime", async () => {
    const editor = await mountEditor("editor-commands-custom-invalid-selector", headingDoc)

    await expectRejectTag(
      runCommand(editor, customCommands.replaceBySelector, {
        selector: { type: "heading", attrs: { level: 99 } },
        content: { type: "paragraph", content: [{ type: "text", text: "bad" }] },
      } as never),
      "CommandValidationError",
    )
  })

  it("custom document command reports missing selector matches", async () => {
    const editor = await mountEditor("editor-commands-custom-missing-selector")

    await expectRejectTag(
      runCommand(editor, customCommands.replaceBySelector, {
        selector: { type: "heading", text: "Missing" },
        content: { type: "paragraph", content: [{ type: "text", text: "nope" }] },
      }),
      "DocumentSelectorError",
    )
  })
})
