import type { Extensions } from "@tiptap/core"
import type { EditorSchema } from "../../schema/define"
import { NodeViewStore } from "../../react/internal/node-view-store"
import { withoutPmHistory } from "./strip-pm-history"
import { withReactNodeViews } from "./editor-node-views"
import type { EditorSchemaMarks, EditorSchemaNodes, EditorSpec } from "./types"

const buildBaseExtensions = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  extra: Extensions | undefined,
): Extensions => {
  const all: Extensions = [...schema.tiptapExtensions, ...(extra ?? [])]
  return withoutPmHistory(all, { strict: true })
}

const buildEditorExtensions = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
  nodeViewStore: NodeViewStore,
): Extensions =>
  withReactNodeViews(
    spec.schema,
    buildBaseExtensions(spec.schema, spec.extensions),
    nodeViewStore,
  )

export { buildBaseExtensions, buildEditorExtensions }
