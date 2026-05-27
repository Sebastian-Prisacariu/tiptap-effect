import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { defineEditorCommand, Sequence, sequenceRecordSchema } from "tiptap-effect/command"

const InsertTextCommand = defineEditorCommand({
  op: "test.insert.text",
  description: ({ text }) => `Insert ${text}`,
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ from: Schema.Number, length: Schema.Number }),
  apply: (chain, { text }) => chain.insertContent(text),
  reverseSetup: (state, { text }) => ({ from: state.selection.from, length: text.length }),
  applyReverse: (chain, _input, { from, length }) =>
    chain.deleteRange({ from, to: from + length }),
})

describe("Sequence — record encode/decode", () => {
  it("toRecord(inputs) produces { op, steps: [{op, input}, ...] }", () => {
    const InsertAB = Sequence.atomic(
      "test.insert-ab",
      [InsertTextCommand, InsertTextCommand] as const,
      () => "AB",
    )

    const record = InsertAB.toRecord([{ text: "A" }, { text: "B" }] as const)
    expect(record).toEqual({
      op: "test.insert-ab",
      steps: [
        { op: InsertTextCommand.op, input: { text: "A" } },
        { op: InsertTextCommand.op, input: { text: "B" } },
      ],
    })
    // stepOps is also exposed for runtime introspection (audit / dev tools)
    expect(InsertAB.stepOps).toEqual([InsertTextCommand.op, InsertTextCommand.op])
  })

  it("Schema.encode(sequenceRecordSchema)(record) round-trips through decode", () => {
    const InsertAB = Sequence.atomic(
      "test.insert-ab-encode",
      [InsertTextCommand, InsertTextCommand] as const,
      () => "AB",
    )

    const original = InsertAB.toRecord([{ text: "X" }, { text: "Y" }] as const)
    const encoded = Effect.runSync(Schema.encode(sequenceRecordSchema)(original))
    const decoded = Effect.runSync(Schema.decodeUnknown(sequenceRecordSchema)(encoded))

    expect(decoded).toEqual(original)
    // Encoded shape is JSON-friendly (no class instances, plain objects only)
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(original)
  })

  it("Sequence.recordSchema is exported on the namespace and is the same schema", () => {
    expect(Sequence.recordSchema).toBe(sequenceRecordSchema)
  })

  it("nested sequences produce nested records (audit logs preserve tree structure)", () => {
    const Inner = Sequence.atomic(
      "test.inner",
      [InsertTextCommand, InsertTextCommand] as const,
      () => "inner",
    )
    const Outer = Sequence.sequential(
      "test.outer",
      [Inner, InsertTextCommand] as const,
      () => "outer",
    )

    const record = Outer.toRecord([
      [{ text: "A" }, { text: "B" }],
      { text: "C" },
    ] as const)
    expect(record).toEqual({
      op: "test.outer",
      steps: [
        { op: "test.inner", input: [{ text: "A" }, { text: "B" }] },
        { op: InsertTextCommand.op, input: { text: "C" } },
      ],
    })
    // Inner step's `input` field still round-trips through Schema.decode
    // because the outer record's step.input is Schema.Unknown.
    const encoded = Effect.runSync(Schema.encode(sequenceRecordSchema)(record))
    const decoded = Effect.runSync(Schema.decodeUnknown(sequenceRecordSchema)(encoded))
    expect(decoded).toEqual(record)
  })
})
