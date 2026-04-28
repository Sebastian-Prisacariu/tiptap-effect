import { Schema } from "effect"

/**
 * Public, Schema-typed representation of the editor selection.
 * Replaces ProseMirror's `Selection` class so PM types don't leak into
 * consumer code. Discriminated by `kind`.
 */
export const SelectionInfo = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("text"),
    from: Schema.Number,
    to: Schema.Number,
    head: Schema.Number,
    empty: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("node"),
    pos: Schema.Number,
    nodeType: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("all"),
    from: Schema.Number,
    to: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("gap"),
    pos: Schema.Number,
  }),
)

export type SelectionInfo = typeof SelectionInfo.Type
