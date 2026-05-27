import { Registry } from "@effect-atom/atom"
import { Node as TiptapNodeExt } from "@tiptap/core"
import { Effect, Logger, LogLevel } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeEditorAtom } from "tiptap-effect/editor"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { EditorId } from "tiptap-effect"
import { checkDocumentSchema } from "../../src/editor/internal/document-validation"
import { waitForAtom } from "../helpers/atom"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

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

const collectWarnings = async (
  effect: Effect.Effect<void, unknown>,
): Promise<ReadonlyArray<unknown>> => {
  const messages: Array<unknown> = []
  const logger = Logger.make<unknown, void>((options) => {
    messages.push(options.message)
  })

  await Effect.runPromise(
    effect.pipe(
      Logger.withMinimumLogLevel(LogLevel.Warning),
      Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
    ),
  )

  return messages
}

const stateFromJson = (json: unknown): unknown => ({
  doc: {
    toJSON: () => json,
  },
})

describe("schema-extension dedup", () => {
  it("throws when an `extensions` entry duplicates a node already declared in schema", async () => {
    const Duplicate = TiptapNodeExt.create({ name: "paragraph", group: "block" })
    const id = EditorId("ed-dup-1")

    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
      extensions: [Duplicate],
    })
    const _keep = registry.subscribe(editorAtom, () => {})

    await expect(waitForAtom(registry, editorAtom)).rejects.toBeDefined()
    void _keep
  })

  it("does not throw when extensions only contain non-colliding extensions", async () => {
    // Empty extensions — nothing to collide with.
    const id = EditorId("ed-dup-2")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
      extensions: [],
    })
    const _keep = registry.subscribe(editorAtom, () => {})

    const handle = await waitForAtom(registry, editorAtom)
    expect(handle._internal.editor).toBeDefined()
    void _keep
  })
})

describe("onSchemaMismatch", () => {
  it("can skip schema checks when onSchemaMismatch is ignore", async () => {
    const id = EditorId("ed-dsc-off")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
      onSchemaMismatch: "ignore",
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)

    handle._internal.editor.commands.insertContent(" more")
    await new Promise((r) => setTimeout(r, 30))

    expect(handle._internal.editor.getText()).toContain("more")
    void _keep
  })

  it("does not log through Effect when the checked doc remains valid", async () => {
    const messages = await collectWarnings(
      checkDocumentSchema(lessonSchema, stateFromJson(validDoc)),
    )

    expect(messages).toHaveLength(0)
  })

  it("keeps the transaction subscription healthy when onSchemaMismatch=log and the doc remains valid", async () => {
    const id = EditorId("ed-dsc-valid")
    const editorAtom = makeEditorAtom({
      id,
      schema: lessonSchema,
      defaultContent: validDoc,
      onSchemaMismatch: "log",
    })
    const _keep = registry.subscribe(editorAtom, () => {})
    const handle = await waitForAtom(registry, editorAtom)

    handle._internal.editor.commands.insertContent(" more")
    await new Promise((r) => setTimeout(r, 30))

    expect(handle._internal.editor.getText()).toContain("more")
    void _keep
  })

  it("logs through Effect when a doc fails schema decode", async () => {
    const invalidDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "X" }] },
      ],
    }
    const messages = await collectWarnings(
      checkDocumentSchema(lessonSchema, stateFromJson(invalidDoc)),
    )

    expect(messages).toHaveLength(1)
    expect(String(messages[0])).toContain("onSchemaMismatch")
  })

})
