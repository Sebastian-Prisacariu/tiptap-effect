import { Effect, Schema } from "effect"
import { EditorInitError, type EditorSchemaMarks, type EditorSchemaNodes, type EditorSpec } from "./types"

const decodeInitialContent = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
) =>
  Schema.decodeUnknown(spec.schema.Document)(
    spec.schema.migrate(spec.defaultContent),
  ).pipe(Effect.mapError((cause) => new EditorInitError({ cause })))

export { decodeInitialContent }
