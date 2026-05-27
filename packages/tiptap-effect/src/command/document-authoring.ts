import type { JSONContent, Editor as TiptapEditor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { Data, Effect, Schema } from "effect";
import {
  DocumentSelectorError,
  findDocumentMatches,
  type DocumentMatch,
  type DocumentSelector,
} from "../document/selector";
import type {
  AnyEditorSchema,
  AttrsOfNode,
  DocumentOf,
  InsertableContentOf,
  NodeNameOf,
} from "../schema/define";
import { CurrentEditor } from "./internal/current-editor";

type Chain = ReturnType<TiptapEditor["chain"]>;

export class EditorCommandError extends Data.TaggedError(
  "EditorCommandError",
)<{
  readonly message: string;
}> {}

export class ContentPositionError extends Data.TaggedError(
  "ContentPositionError",
)<{
  readonly pos: number;
  readonly message: string;
}> {}

type SelectorBase = {
  readonly text?: string;
  readonly textIncludes?: string;
  readonly textMatches?: string;
  readonly nth?: number;
};

type AnySchema = Schema.Schema<any, any, any>;

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

export interface DocumentCommandAuthoring<S extends AnyEditorSchema> {
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
  readonly currentFromState: (state: EditorState) => DocumentOf<S>;
  readonly capturePreviousContent: (
    state: EditorState,
  ) => PreviousContentOutput<S>;
  readonly restorePreviousContent: (
    input: unknown,
    output: PreviousContentOutput<S>,
  ) => Effect.Effect<void, never, CurrentEditor>;
  readonly applyRestorePreviousContent: (
    chain: Chain,
    input: unknown,
    output: PreviousContentOutput<S>,
  ) => Chain;
  readonly setContent: (
    input: SetContentInput<S>,
  ) => Effect.Effect<PreviousContentOutput<S>, never, CurrentEditor>;
  readonly clearContent: () => Effect.Effect<
    PreviousContentOutput<S>,
    never,
    CurrentEditor
  >;
  readonly insertContentAt: (
    input: InsertContentAtInput<S>,
  ) => Effect.Effect<PreviousContentOutput<S>, never, CurrentEditor>;
  readonly replaceRange: (
    input: ReplaceRangeInput<S>,
  ) => Effect.Effect<PreviousContentOutput<S>, never, CurrentEditor>;
  readonly deleteRange: (
    input: DeleteRangeInput,
  ) => Effect.Effect<PreviousContentOutput<S>, never, CurrentEditor>;
  readonly deleteNodeAt: (
    input: { readonly pos: number },
  ) => Effect.Effect<PreviousContentOutput<S>, ContentPositionError, CurrentEditor>;
  readonly replaceNodeAt: (
    input: ReplaceNodeAtInput<S>,
  ) => Effect.Effect<PreviousContentOutput<S>, ContentPositionError, CurrentEditor>;
  readonly updateNodeAttrsAt: (
    input: UpdateNodeAttrsAtInput<S>,
  ) => Effect.Effect<
    UpdateAttrsAtOutput<S>,
    ContentPositionError | EditorCommandError,
    CurrentEditor
  >;
  readonly findMatches: (
    input: SelectorInput<S>,
  ) => Effect.Effect<ReadonlyArray<DocumentMatch>, never, CurrentEditor>;
  readonly insertContentAtMatch: (
    input: SelectorInsertInput<S>,
  ) => Effect.Effect<SelectorPatchOutput<S>, DocumentSelectorError, CurrentEditor>;
  readonly replaceMatches: (
    input: SelectorReplaceInput<S>,
  ) => Effect.Effect<SelectorPatchOutput<S>, DocumentSelectorError, CurrentEditor>;
  readonly deleteMatches: (
    input: SelectorManyInput<S>,
  ) => Effect.Effect<SelectorPatchOutput<S>, DocumentSelectorError, CurrentEditor>;
  readonly updateNodeAttrsBySelector: (
    input: UpdateNodeAttrsBySelectorInput<S>,
  ) => Effect.Effect<SelectorPatchOutput<S>, DocumentSelectorError, CurrentEditor>;
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

const makeInputs = <S extends AnyEditorSchema>(schema: S) => {
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
  };
};

const makeOutputs = <S extends AnyEditorSchema>(schema: S) => ({
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
});

const selectMatches = (
  doc: ProseMirrorNode,
  selector: DocumentSelector,
  all: boolean | undefined,
): Effect.Effect<ReadonlyArray<DocumentMatch>, DocumentSelectorError> =>
  Effect.sync(() => {
    const matches = findDocumentMatches(doc, selector);
    return all === true ? matches : matches.slice(0, 1);
  }).pipe(
    Effect.flatMap((matches) =>
      matches.length > 0
        ? Effect.succeed(matches)
        : Effect.fail(
            new DocumentSelectorError({
              selector,
              message: "No document nodes matched selector",
            }),
          ),
    ),
  );

export const makeDocumentCommandAuthoring = <S extends AnyEditorSchema>(
  schema: S,
): DocumentCommandAuthoring<S> => {
  const currentFromState = (state: EditorState): DocumentOf<S> =>
    state.doc.toJSON() as DocumentOf<S>;

  const capturePreviousContent = (
    state: EditorState,
  ): PreviousContentOutput<S> => ({
    previousContent: currentFromState(state),
  });

  const restorePreviousContent = (
    _input: unknown,
    { previousContent }: PreviousContentOutput<S>,
  ) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      editor.commands.setContent(previousContent as JSONContent);
    });

  const previous = (editor: { readonly state: EditorState }) =>
    capturePreviousContent(editor.state);

  const inputs = makeInputs(schema);
  const outputs = makeOutputs(schema);

  return {
    inputs,
    outputs,
    currentFromState,
    capturePreviousContent,
    restorePreviousContent,
    applyRestorePreviousContent: (chain, _input, { previousContent }) =>
      chain.setContent(previousContent as JSONContent),
    setContent: ({ content }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        editor.commands.setContent(content as JSONContent);
        return output;
      }),
    clearContent: () =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        editor.commands.clearContent(true);
        return output;
      }),
    insertContentAt: ({ pos, content }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        editor.commands.insertContentAt(pos, content as JSONContent | string);
        return output;
      }),
    replaceRange: ({ from, to, content }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        editor.commands.insertContentAt(
          { from, to },
          content as JSONContent | string,
        );
        return output;
      }),
    deleteRange: ({ from, to }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        editor.commands.deleteRange({ from, to });
        return output;
      }),
    deleteNodeAt: ({ pos }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const node = editor.state.doc.nodeAt(pos);
        if (!node) {
          return yield* new ContentPositionError({
            pos,
            message: `No node found at position ${pos}`,
          });
        }
        const output = previous(editor);
        editor
          .chain()
          .deleteRange({ from: pos, to: pos + node.nodeSize })
          .run();
        return output;
      }),
    replaceNodeAt: ({ pos, content }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const node = editor.state.doc.nodeAt(pos);
        if (!node) {
          return yield* new ContentPositionError({
            pos,
            message: `No node found at position ${pos}`,
          });
        }
        const output = previous(editor);
        editor
          .chain()
          .insertContentAt(
            { from: pos, to: pos + node.nodeSize },
            content as JSONContent | string,
          )
          .run();
        return output;
      }),
    updateNodeAttrsAt: ({ pos, type, attrs }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const node = editor.state.doc.nodeAt(pos);
        if (!node) {
          return yield* new ContentPositionError({
            pos,
            message: `No node found at position ${pos}`,
          });
        }
        if (node.isText || node.type.name !== type) {
          return yield* new EditorCommandError({
            message: `Expected ${type} node at position ${pos}, found ${node.type.name}`,
          });
        }
        const output = previous(editor);
        const previousAttrs = node.attrs;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(
            pos,
            undefined,
            { ...node.attrs, ...attrs },
            node.marks,
          ),
        );
        return {
          ...output,
          previousAttrs,
          nodeType: node.type.name,
        };
      }),
    findMatches: ({ selector }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        return findDocumentMatches(
          editor.state.doc,
          selector as DocumentSelector,
        );
      }),
    insertContentAtMatch: ({ selector, content, at = "after" }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        const matches = yield* selectMatches(
          editor.state.doc,
          selector as DocumentSelector,
          false,
        );
        const match = matches[0]!;
        const pos =
          at === "before"
            ? match.from
            : at === "after"
              ? match.to
              : at === "start"
                ? match.from + 1
                : match.to - 1;
        editor.commands.insertContentAt(pos, content as JSONContent | string);
        return { ...output, count: 1 };
      }),
    replaceMatches: ({ selector, content, all }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        const matches = yield* selectMatches(
          editor.state.doc,
          selector as DocumentSelector,
          all,
        );
        for (const match of [...matches].sort((a, b) => b.from - a.from)) {
          editor.commands.insertContentAt(
            { from: match.from, to: match.to },
            content as JSONContent | string,
          );
        }
        return { ...output, count: matches.length };
      }),
    deleteMatches: ({ selector, all }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        const matches = yield* selectMatches(
          editor.state.doc,
          selector as DocumentSelector,
          all,
        );
        for (const match of [...matches].sort((a, b) => b.from - a.from)) {
          editor.commands.deleteRange({ from: match.from, to: match.to });
        }
        return { ...output, count: matches.length };
      }),
    updateNodeAttrsBySelector: ({ selector, attrs, all }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        const matches = yield* selectMatches(
          editor.state.doc,
          selector as DocumentSelector,
          all,
        );
        for (const match of matches) {
          const node = editor.state.doc.nodeAt(match.pos);
          if (!node || node.isText) {
            return yield* new DocumentSelectorError({
              selector,
              message: `Cannot update attrs at position ${match.pos}`,
            });
          }
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(
              match.pos,
              undefined,
              { ...node.attrs, ...attrs },
              node.marks,
            ),
          );
        }
        return { ...output, count: matches.length };
      }),
  };
};
