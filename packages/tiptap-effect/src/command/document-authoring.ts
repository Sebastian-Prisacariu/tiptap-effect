import type { JSONContent, Editor as TiptapEditor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { Data, Effect, Schema } from "effect";
import {
  defineCommand,
  defineEditorCommand,
  type CoalescePair,
  type Command,
  type ConcurrencyPolicy,
  type EditorCommand,
} from "./command";
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
  /**
   * Helpers for defining Commands that mutate document content and undo by
   * restoring the previous typed document.
   */
  readonly patch: DocumentPatchAuthoring<S>;
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
  readonly selectMatches: (
    doc: ProseMirrorNode,
    selector: DocumentSelector,
    all?: boolean,
  ) => Effect.Effect<ReadonlyArray<DocumentMatch>, DocumentSelectorError>;
  readonly applyReplaceMatches: (
    input: SelectorReplaceInput<S>,
  ) => Effect.Effect<number, DocumentSelectorError, CurrentEditor>;
  readonly applyDeleteMatches: (
    input: SelectorManyInput<S>,
  ) => Effect.Effect<number, DocumentSelectorError, CurrentEditor>;
}

type Description<In> = (input: In) => string;

export interface BaseDocumentPatchSpec<Op extends string, In> {
  /** Stable operation id stored in command history and error events. */
  readonly op: Op;
  /** Human-readable description for history/debug UIs. */
  readonly description: Description<In>;
  /** Runtime input validation for the patch command. */
  readonly inputSchema: Schema.Schema<In>;
}

export interface EditorDocumentPatchSpec<
  S extends AnyEditorSchema,
  Op extends string,
  In,
> extends BaseDocumentPatchSpec<Op, In> {
  /** Tiptap chain mutation to run after the previous document is captured. */
  readonly apply: (chain: Chain, input: In) => Chain;
  readonly capturesSelection?: boolean;
  readonly coalesceKey?: (input: In) => string;
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  readonly transactional?: boolean;
  readonly coalesce?: (
    prev: CoalescePair<In, PreviousContentOutput<S>>,
    next: CoalescePair<In, PreviousContentOutput<S>>,
  ) => CoalescePair<In, PreviousContentOutput<S>> | null;
}

export interface EffectDocumentPatchSpec<Op extends string, In, Err>
  extends BaseDocumentPatchSpec<Op, In> {
  /** Effectful document mutation to run after the previous document is captured. */
  readonly apply: (input: In) => Effect.Effect<void, Err, CurrentEditor>;
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  readonly transactional?: boolean;
}

export interface SelectorDocumentPatchSpec<Op extends string, In, Err>
  extends BaseDocumentPatchSpec<Op, In> {
  /** Effectful selector mutation. Return the number of patched nodes. */
  readonly apply: (input: In) => Effect.Effect<number, Err, CurrentEditor>;
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  readonly transactional?: boolean;
}

/**
 * Public authoring helpers for schema-bound document patches.
 *
 * A document patch is a Command that mutates the editor document and records
 * the previous typed document as its undo output. This keeps the common
 * reversible-document-command contract in one module: capture previous
 * content before mutation, validate the output shape, and restore that content
 * on reverse.
 */
export interface DocumentPatchAuthoring<S extends AnyEditorSchema> {
  /** Read the current editor document as the schema-bound document type. */
  readonly currentFromState: (state: EditorState) => DocumentOf<S>;
  /** Capture the current document for a future undo restore. */
  readonly capturePreviousContent: (
    state: EditorState,
  ) => PreviousContentOutput<S>;
  /** Restore a previously captured document from an Effect command reverse. */
  readonly restorePreviousContent: (
    input: unknown,
    output: PreviousContentOutput<S>,
  ) => Effect.Effect<void, never, CurrentEditor>;
  /** Restore a previously captured document from a Tiptap chain reverse. */
  readonly applyRestorePreviousContent: (
    chain: Chain,
    input: unknown,
    output: PreviousContentOutput<S>,
  ) => Chain;
  /**
   * Build a reversible EditorCommand from a Tiptap chain mutation.
   *
   * Use this when the patch can be expressed as `chain.*`; the helper supplies
   * previous-content output, capture, and restore.
   */
  readonly editorCommand: <Op extends string, In>(
    spec: EditorDocumentPatchSpec<S, Op, In>,
  ) => EditorCommand<Op, In, PreviousContentOutput<S>>;
  /**
   * Build a reversible Command from an Effectful document mutation.
   *
   * Use this when the patch needs direct editor/state access or custom errors.
   */
  readonly command: <Op extends string, In, Err = never>(
    spec: EffectDocumentPatchSpec<Op, In, Err>,
  ) => Command<Op, In, PreviousContentOutput<S>, Err, CurrentEditor>;
  /**
   * Build a reversible selector patch Command.
   *
   * The mutation returns the number of changed nodes; the command output is
   * `{ previousContent, count }`.
   */
  readonly selectorCommand: <Op extends string, In, Err = DocumentSelectorError>(
    spec: SelectorDocumentPatchSpec<Op, In, Err>,
  ) => Command<Op, In, SelectorPatchOutput<S>, Err, CurrentEditor>;
  /** Find selector matches or fail when none match. Respects `all`. */
  readonly selectMatches: (
    doc: ProseMirrorNode,
    selector: DocumentSelector,
    all?: boolean,
  ) => Effect.Effect<ReadonlyArray<DocumentMatch>, DocumentSelectorError>;
  /** Replace matching nodes and return the number of replacements. */
  readonly applyReplaceMatches: (
    input: SelectorReplaceInput<S>,
  ) => Effect.Effect<number, DocumentSelectorError, CurrentEditor>;
  /** Delete matching nodes and return the number of deletions. */
  readonly applyDeleteMatches: (
    input: SelectorManyInput<S>,
  ) => Effect.Effect<number, DocumentSelectorError, CurrentEditor>;
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
  const applyReplaceMatches = ({ selector, content, all }: SelectorReplaceInput<S>) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
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
      return matches.length;
    });
  const applyDeleteMatches = ({ selector, all }: SelectorManyInput<S>) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      const matches = yield* selectMatches(
        editor.state.doc,
        selector as DocumentSelector,
        all,
      );
      for (const match of [...matches].sort((a, b) => b.from - a.from)) {
        editor.commands.deleteRange({ from: match.from, to: match.to });
      }
      return matches.length;
    });
  const makeEditorPatchCommand = <Op extends string, In>(
    spec: EditorDocumentPatchSpec<S, Op, In>,
  ): EditorCommand<Op, In, PreviousContentOutput<S>> =>
    defineEditorCommand<Op, In, PreviousContentOutput<S>>({
      op: spec.op,
      description: spec.description,
      inputSchema: spec.inputSchema,
      outputSchema: outputs.previousContent,
      reverseSetup: capturePreviousContent,
      apply: spec.apply,
      applyReverse: (chain, input, output) =>
        patch.applyRestorePreviousContent(chain, input, output),
      capturesSelection: spec.capturesSelection,
      coalesceKey: spec.coalesceKey,
      coalesce: spec.coalesce,
      concurrencyPolicy: spec.concurrencyPolicy,
      transactional: spec.transactional,
    });
  const patch: DocumentPatchAuthoring<S> = {
    currentFromState,
    capturePreviousContent,
    restorePreviousContent,
    applyRestorePreviousContent: (chain, _input, { previousContent }) =>
      chain.setContent(previousContent as JSONContent),
    editorCommand: makeEditorPatchCommand,
    command: (spec) =>
      defineCommand({
        op: spec.op,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: outputs.previousContent,
        forward: (input) =>
          Effect.gen(function* () {
            const editor = yield* CurrentEditor;
            const output = capturePreviousContent(editor.state);
            yield* spec.apply(input);
            return output;
          }),
        reverse: restorePreviousContent,
        concurrencyPolicy: spec.concurrencyPolicy,
        transactional: spec.transactional,
      }),
    selectorCommand: (spec) =>
      defineCommand({
        op: spec.op,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: outputs.patch,
        forward: (input) =>
          Effect.gen(function* () {
            const editor = yield* CurrentEditor;
            const output = capturePreviousContent(editor.state);
            const count = yield* spec.apply(input);
            return { ...output, count };
          }),
        reverse: restorePreviousContent,
        concurrencyPolicy: spec.concurrencyPolicy,
        transactional: spec.transactional,
      }),
    selectMatches,
    applyReplaceMatches,
    applyDeleteMatches,
  };

  return {
    patch,
    inputs,
    outputs,
    currentFromState,
    capturePreviousContent,
    restorePreviousContent,
    applyRestorePreviousContent: patch.applyRestorePreviousContent,
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
    selectMatches,
    applyReplaceMatches,
    applyDeleteMatches,
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
        const count = yield* applyReplaceMatches({ selector, content, all });
        return { ...output, count };
      }),
    deleteMatches: ({ selector, all }) =>
      Effect.gen(function* () {
        const editor = yield* CurrentEditor;
        const output = previous(editor);
        const count = yield* applyDeleteMatches({ selector, all });
        return { ...output, count };
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
