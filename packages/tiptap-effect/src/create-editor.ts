import {
  docAtom,
  htmlAtom,
  makeEditorAtom,
  plainTextAtom,
  transactionBusAtom,
  type EditorSpec,
} from "./editor"
import {
  defineEditorCommands,
  type EditorCommandOptions,
  type EditorCommands,
} from "./command/editor-commands"
import type {
  AnyEditorSchema,
  EditorSchema,
} from "./schema/define"
import type { EditorId } from "./types"

type SchemaNodes<S extends AnyEditorSchema> =
  S extends EditorSchema<infer N, infer _M> ? N : never

type SchemaMarks<S extends AnyEditorSchema> =
  S extends EditorSchema<infer _N, infer M> ? M : never

type BoundEditorSpec<S extends AnyEditorSchema> =
  Omit<EditorSpec<SchemaNodes<S>, SchemaMarks<S>>, "schema">

export interface CreatedEditor<
  S extends AnyEditorSchema,
  Custom extends Record<string, unknown>,
> {
  readonly schema: S
  readonly commands: EditorCommands<S> & Custom
  readonly makeAtom: (
    spec: BoundEditorSpec<S>,
  ) => ReturnType<typeof makeEditorAtom<SchemaNodes<S>, SchemaMarks<S>>>
  readonly atoms: {
    readonly document: (id: EditorId) => ReturnType<typeof docAtom<SchemaNodes<S>, SchemaMarks<S>>>
    readonly html: (id: EditorId) => ReturnType<typeof htmlAtom<SchemaNodes<S>, SchemaMarks<S>>>
    readonly text: (id: EditorId) => ReturnType<typeof plainTextAtom>
    readonly transaction: (id: EditorId) => ReturnType<typeof transactionBusAtom>
  }
}

export const createEditor = <
  const S extends AnyEditorSchema,
  Custom extends Record<string, unknown> = {},
>(
  schema: S,
  options: EditorCommandOptions<S, Custom> = {},
): CreatedEditor<S, Custom> => {
  const commands = defineEditorCommands(schema, options)

  return {
    schema,
    commands,
    makeAtom: (spec) =>
      makeEditorAtom({
        ...spec,
        schema,
      }),
    atoms: {
      document: (id) => docAtom(id, schema),
      html: (id) => htmlAtom(id, schema),
      text: plainTextAtom,
      transaction: transactionBusAtom,
    },
  }
}
