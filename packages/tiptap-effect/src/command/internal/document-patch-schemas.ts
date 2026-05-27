import { Schema } from "effect";
import type {
  AnyEditorSchema,
  AttrsOfNode,
  DocumentOf,
  InsertableContentOf,
  NodeNameOf,
} from "../../schema/define";

type AnySchema = Schema.Schema<any, any, any>;

type SelectorBase = {
  readonly text?: string;
  readonly textIncludes?: string;
  readonly textMatches?: string;
  readonly nth?: number;
};

type TextOnlySelector = SelectorBase & {
  readonly type?: undefined;
  readonly attrs?: never;
};

type TypedSelectorByNode<S extends AnyEditorSchema> = {
  readonly [Name in NodeNameOf<S>]: SelectorBase & {
    readonly type: Name;
    readonly attrs?: Partial<AttrsOfNode<S, Name>>;
  };
}[NodeNameOf<S>];

export type TypedNodeSelector<S extends AnyEditorSchema> =
  | TextOnlySelector
  | TypedSelectorByNode<S>;

export type TypedNodeSelectorWithType<S extends AnyEditorSchema> =
  TypedSelectorByNode<S>;

type EditableNodeNameOf<S extends AnyEditorSchema> = Exclude<
  NodeNameOf<S>,
  "doc" | "text"
>;

export type UpdateNodeAttrsAtInput<S extends AnyEditorSchema> = {
  readonly [Name in EditableNodeNameOf<S>]: {
    readonly pos: number;
    readonly type: Name;
    readonly attrs: Partial<AttrsOfNode<S, Name>>;
  };
}[EditableNodeNameOf<S>];

export type UpdateNodeAttrsBySelectorInput<S extends AnyEditorSchema> = {
  readonly [Name in EditableNodeNameOf<S>]: {
    readonly selector: SelectorBase & {
      readonly type: Name;
      readonly attrs?: Partial<AttrsOfNode<S, Name>>;
    };
    readonly attrs: Partial<AttrsOfNode<S, Name>>;
    readonly all?: boolean;
  };
}[EditableNodeNameOf<S>];

export type SetContentInput<S extends AnyEditorSchema> = {
  readonly content: DocumentOf<S>;
};

export type InsertContentAtInput<S extends AnyEditorSchema> = {
  readonly pos: number;
  readonly content: InsertableContentOf<S>;
};

export type ReplaceRangeInput<S extends AnyEditorSchema> = {
  readonly from: number;
  readonly to: number;
  readonly content: InsertableContentOf<S>;
};

export type DeleteRangeInput = {
  readonly from: number;
  readonly to: number;
};

export type ReplaceNodeAtInput<S extends AnyEditorSchema> = {
  readonly pos: number;
  readonly content: InsertableContentOf<S>;
};

export type SelectorInput<S extends AnyEditorSchema> = {
  readonly selector: TypedNodeSelector<S>;
};

export type SelectorManyInput<S extends AnyEditorSchema> = SelectorInput<S> & {
  readonly all?: boolean;
};

export type SelectorInsertInput<S extends AnyEditorSchema> = SelectorInput<S> & {
  readonly content: InsertableContentOf<S>;
  readonly at?: "before" | "after" | "start" | "end";
};

export type SelectorReplaceInput<S extends AnyEditorSchema> =
  SelectorManyInput<S> & {
    readonly content: InsertableContentOf<S>;
  };

export type PreviousContentOutput<S extends AnyEditorSchema> = {
  readonly previousContent: DocumentOf<S>;
};

export type SelectorPatchOutput<S extends AnyEditorSchema> =
  PreviousContentOutput<S> & {
    readonly count: number;
  };

export type UpdateAttrsAtOutput<S extends AnyEditorSchema> =
  PreviousContentOutput<S> & {
    readonly previousAttrs: unknown;
    readonly nodeType: string;
  };

export interface DocumentPatchSchemas<S extends AnyEditorSchema> {
  readonly inputs: {
    readonly setContent: Schema.Schema<SetContentInput<S>>;
    readonly insertContentAt: Schema.Schema<InsertContentAtInput<S>>;
    readonly replaceRange: Schema.Schema<ReplaceRangeInput<S>>;
    readonly replaceNodeAt: Schema.Schema<ReplaceNodeAtInput<S>>;
    readonly selector: Schema.Schema<SelectorInput<S>>;
    readonly selectorMany: Schema.Schema<SelectorManyInput<S>>;
    readonly selectorInsert: Schema.Schema<SelectorInsertInput<S>>;
    readonly selectorReplace: Schema.Schema<SelectorReplaceInput<S>>;
    readonly updateAttrsAt: Schema.Schema<UpdateNodeAttrsAtInput<S>>;
    readonly updateBySelector: Schema.Schema<UpdateNodeAttrsBySelectorInput<S>>;
  };
  readonly outputs: {
    readonly previousContent: Schema.Schema<PreviousContentOutput<S>>;
    readonly patch: Schema.Schema<SelectorPatchOutput<S>>;
    readonly updateAttrsAt: Schema.Schema<UpdateAttrsAtOutput<S>>;
  };
}

const selectorBaseFields = {
  text: Schema.optional(Schema.String),
  textIncludes: Schema.optional(Schema.String),
  textMatches: Schema.optional(Schema.String),
  nth: Schema.optional(Schema.Number),
};

const unionOrNever = (schemas: ReadonlyArray<AnySchema>): AnySchema => {
  if (schemas.length === 0) return Schema.Union() as unknown as AnySchema;
  if (schemas.length === 1) return schemas[0]!;
  return Schema.Union(
    ...(schemas as [AnySchema, AnySchema, ...Array<AnySchema>]),
  );
};

const textOnlySelectorSchema = Schema.Struct({
  ...selectorBaseFields,
  type: Schema.optional(Schema.Undefined),
  attrs: Schema.optional(Schema.Undefined),
});

const nodeNames = (schema: AnyEditorSchema): ReadonlyArray<string> =>
  Object.keys(schema.nodes);

const editableNodeNames = (schema: AnyEditorSchema): ReadonlyArray<string> =>
  nodeNames(schema).filter((name) => name !== "doc" && name !== "text");

const nodeSelectorSchemas = (
  schema: AnyEditorSchema,
  names: ReadonlyArray<string> = nodeNames(schema),
): ReadonlyArray<AnySchema> =>
  names.map((name) =>
    Schema.Struct({
      ...selectorBaseFields,
      type: Schema.Literal(name),
      attrs: Schema.optional(
        schema.partialNodeAttrsSchemas[name] ?? Schema.Struct({}),
      ),
    }),
  );

const typedSelectorSchema = <S extends AnyEditorSchema>(
  schema: S,
): Schema.Schema<TypedNodeSelector<S>> =>
  unionOrNever([
    textOnlySelectorSchema,
    ...nodeSelectorSchemas(schema),
  ]) as Schema.Schema<TypedNodeSelector<S>>;

const insertableContentSchema = <S extends AnyEditorSchema>(
  schema: S,
): Schema.Schema<InsertableContentOf<S>> => {
  const insertableNode = (schema.NodeUnion as unknown as AnySchema).pipe(
    Schema.filter(
      (node: unknown) => (node as { readonly type?: string }).type !== "doc",
      {
        message: () => "Insertable content cannot be a full doc node",
      },
    ),
  );
  return Schema.Union(
    insertableNode,
    Schema.Array(insertableNode),
    Schema.String,
  ) as unknown as Schema.Schema<InsertableContentOf<S>>;
};

export const makeDocumentPatchSchemas = <S extends AnyEditorSchema>(
  schema: S,
): DocumentPatchSchemas<S> => {
  const insertable = insertableContentSchema(schema);
  const selector = typedSelectorSchema(schema);
  const editableNames = editableNodeNames(schema);
  const editableSelectorSchemas = nodeSelectorSchemas(schema, editableNames);
  const updateAttrsAt = unionOrNever(
    editableNames.map((name) =>
      Schema.Struct({
        pos: Schema.Number,
        type: Schema.Literal(name),
        attrs: schema.partialNodeAttrsSchemas[name] ?? Schema.Struct({}),
      }),
    ),
  ) as Schema.Schema<UpdateNodeAttrsAtInput<S>>;
  const updateBySelector = unionOrNever(
    editableNames.map((name, index) =>
      Schema.Struct({
        selector:
          editableSelectorSchemas[index] ??
          Schema.Struct({ type: Schema.Literal(name) }),
        attrs: schema.partialNodeAttrsSchemas[name] ?? Schema.Struct({}),
        all: Schema.optional(Schema.Boolean),
      }),
    ),
  ) as Schema.Schema<UpdateNodeAttrsBySelectorInput<S>>;

  return {
    inputs: {
      setContent: Schema.Struct({
        content: schema.Document,
      }) as Schema.Schema<SetContentInput<S>>,
      insertContentAt: Schema.Struct({
        pos: Schema.Number,
        content: insertable,
      }) as Schema.Schema<InsertContentAtInput<S>>,
      replaceRange: Schema.Struct({
        from: Schema.Number,
        to: Schema.Number,
        content: insertable,
      }) as Schema.Schema<ReplaceRangeInput<S>>,
      replaceNodeAt: Schema.Struct({
        pos: Schema.Number,
        content: insertable,
      }) as Schema.Schema<ReplaceNodeAtInput<S>>,
      selector: Schema.Struct({ selector }) as Schema.Schema<SelectorInput<S>>,
      selectorMany: Schema.Struct({
        selector,
        all: Schema.optional(Schema.Boolean),
      }) as Schema.Schema<SelectorManyInput<S>>,
      selectorInsert: Schema.Struct({
        selector,
        content: insertable,
        at: Schema.optional(Schema.Literal("before", "after", "start", "end")),
      }) as Schema.Schema<SelectorInsertInput<S>>,
      selectorReplace: Schema.Struct({
        selector,
        content: insertable,
        all: Schema.optional(Schema.Boolean),
      }) as Schema.Schema<SelectorReplaceInput<S>>,
      updateAttrsAt,
      updateBySelector,
    },
    outputs: {
      previousContent: Schema.Struct({
        previousContent: schema.Document,
      }) as Schema.Schema<PreviousContentOutput<S>>,
      patch: Schema.Struct({
        previousContent: schema.Document,
        count: Schema.Number,
      }) as Schema.Schema<SelectorPatchOutput<S>>,
      updateAttrsAt: Schema.Struct({
        previousContent: schema.Document,
        previousAttrs: Schema.Unknown,
        nodeType: Schema.String,
      }) as Schema.Schema<UpdateAttrsAtOutput<S>>,
    },
  };
};
