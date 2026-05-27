import type { Extensions } from "@tiptap/core"
import { Effect } from "effect"
import type { EditorSchema } from "../../schema/define"
import type { ReactPortalRegistry } from "./react-portal-registry"
import { withoutPmHistory } from "./strip-pm-history"
import { withReactNodeViews } from "./editor-node-views"
import {
  SchemaCollisionError,
  type EditorSchemaMarks,
  type EditorSchemaNodes,
  type EditorSpec,
} from "./types"

/**
 * Throw when `extra` declares a node/mark that the schema already provides.
 * The schema layer is the canonical source of node/mark definitions; an
 * extra extension with a colliding name would silently override the
 * schema-derived attrs/parser, defeating the schema-first contract.
 */
const assertNoSchemaCollisions = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  extra: Extensions | undefined,
): Effect.Effect<void, SchemaCollisionError> => {
  if (!extra || extra.length === 0) return Effect.void
  const schemaNames = new Set(
    schema.tiptapExtensions.map((e) => (e as { name: string }).name),
  )
  const collisions = extra
    .map((e) => (e as { name: string }).name)
    .filter((name) => schemaNames.has(name))
  if (collisions.length > 0) {
    return Effect.fail(
      new SchemaCollisionError({
        collisions,
        message: `tiptap-effect: extension(s) ${collisions
        .map((n) => `"${n}"`)
        .join(", ")} duplicate node/mark names already declared in schema. `
      + "Move the customisation into the schema's NodeDefinition/MarkDefinition "
      + "instead of layering it through `extensions`.",
      }),
    )
  }
  return Effect.void
}

const buildBaseExtensions: <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  extra: Extensions | undefined,
) => Effect.Effect<Extensions, SchemaCollisionError> =
  Effect.fnUntraced(function* <
    N extends EditorSchemaNodes,
    M extends EditorSchemaMarks,
  >(schema: EditorSchema<N, M>, extra: Extensions | undefined) {
    yield* assertNoSchemaCollisions(schema, extra)
    const all: Extensions = [...schema.tiptapExtensions, ...(extra ?? [])]
    return withoutPmHistory(all, { strict: true })
  })

const buildEditorExtensions = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
  reactPortals: ReactPortalRegistry,
): Effect.Effect<Extensions, SchemaCollisionError> =>
  Effect.map(buildBaseExtensions(spec.schema, spec.extensions), (extensions) =>
    withReactNodeViews(
      spec.schema,
      extensions,
      reactPortals,
    ),
  )

export { buildBaseExtensions, buildEditorExtensions, assertNoSchemaCollisions }
