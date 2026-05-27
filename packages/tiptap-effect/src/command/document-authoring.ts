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
import {
  capturePreviousDocument,
  currentDocumentFromState,
  mergePreviousDocumentOutput,
  orderMatchesDescending,
  restoreDocumentSnapshot,
} from "./internal/document-patch-contract";

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

export interface DocumentPatchReverseContext<In, Out> {
  readonly editor: TiptapEditor;
  readonly input: In;
  readonly output: Out;
  readonly restorePreviousDocument: () => Effect.Effect<void, never, CurrentEditor>;
}

export type DocumentPatchReverse<In, Out, Err> = (
  context: DocumentPatchReverseContext<In, Out>,
) => Effect.Effect<void, Err, CurrentEditor>;

export interface ChainDocumentPatchSpec<
  S extends AnyEditorSchema,
  Op extends string,
  In,
> extends BaseDocumentPatchSpec<Op, In> {
  /** Tiptap chain mutation to run after the previous document is captured. */
  readonly apply: (context: {
    readonly chain: Chain;
    readonly input: In;
  }) => Chain;
  readonly capturesSelection?: boolean;
  readonly coalesceKey?: (input: In) => string;
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  readonly transactional?: boolean;
  readonly coalesce?: (
    prev: CoalescePair<In, PreviousContentOutput<S>>,
    next: CoalescePair<In, PreviousContentOutput<S>>,
  ) => CoalescePair<In, PreviousContentOutput<S>> | null;
}

export interface EffectDocumentPatchSpec<
  S extends AnyEditorSchema,
  Op extends string,
  In,
  Extra extends Record<string, unknown>,
  Err,
>
  extends BaseDocumentPatchSpec<Op, In> {
  /** Effectful document mutation to run after the previous document is captured. */
  readonly run: (context: {
    readonly editor: TiptapEditor;
    readonly input: In;
  }) => Effect.Effect<Extra | void, Err, CurrentEditor>;
  readonly outputSchema?: Schema.Schema<PreviousContentOutput<S> & Extra>;
  /**
   * Custom undo for document patches with external side effects. If omitted,
   * undo restores the previous document. If provided, call
   * `restorePreviousDocument()` unless intentionally replacing the default
   * document-restore behavior.
   */
  readonly reverse?: DocumentPatchReverse<
    In,
    PreviousContentOutput<S> & Extra,
    Err
  >;
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  readonly transactional?: boolean;
}

export interface SelectorDocumentPatchSpec<
  S extends AnyEditorSchema,
  Op extends string,
  In,
  Err,
>
  extends BaseDocumentPatchSpec<Op, In> {
  readonly select: (context: {
    readonly input: In;
  }) => {
    readonly selector: DocumentSelector;
    readonly all?: boolean;
  };
  readonly applyMatch?: (context: {
    readonly editor: TiptapEditor;
    readonly input: In;
    readonly match: DocumentMatch;
  }) => Effect.Effect<void, Err, CurrentEditor> | void;
  readonly applyMatches?: (context: {
    readonly editor: TiptapEditor;
    readonly input: In;
    readonly matches: ReadonlyArray<DocumentMatch>;
  }) => Effect.Effect<number | void, Err, CurrentEditor>;
  /**
   * Custom undo for selector patches with external side effects. If omitted,
   * undo restores the previous document. If provided, call
   * `restorePreviousDocument()` unless intentionally replacing the default
   * document-restore behavior.
   */
  readonly reverse?: DocumentPatchReverse<
    In,
    SelectorPatchOutput<S>,
    Err | DocumentSelectorError
  >;
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
  <Op extends string, In>(
    spec: ChainDocumentPatchSpec<S, Op, In>,
  ): EditorCommand<Op, In, PreviousContentOutput<S>>;
  <Op extends string, In, Extra extends Record<string, unknown>, Err = never>(
    spec: EffectDocumentPatchSpec<S, Op, In, Extra, Err>,
  ): Command<Op, In, PreviousContentOutput<S> & Extra, Err, CurrentEditor>;
  <Op extends string, In, Err = DocumentSelectorError>(
    spec: SelectorDocumentPatchSpec<S, Op, In, Err>,
  ): Command<Op, In, SelectorPatchOutput<S>, Err | DocumentSelectorError, CurrentEditor>;
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
    currentDocumentFromState<DocumentOf<S>>(state);

  const capturePreviousContent = (
    state: EditorState,
  ): PreviousContentOutput<S> =>
    capturePreviousDocument<DocumentOf<S>>(state);

  const restorePreviousContent = (
    _input: unknown,
    { previousContent }: PreviousContentOutput<S>,
  ) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      yield* restoreDocumentSnapshot(editor, previousContent as JSONContent);
    });

  const restorePreviousDocument = (
    output: PreviousContentOutput<S>,
  ): Effect.Effect<void, never, CurrentEditor> =>
    restorePreviousContent(undefined, output);

  const makePatchReverse = <In, Out extends PreviousContentOutput<S>, Err>(
    reverse: DocumentPatchReverse<In, Out, Err> | undefined,
  ) =>
    (input: In, output: Out): Effect.Effect<void, Err, CurrentEditor> =>
      reverse === undefined
        ? restorePreviousDocument(output) as Effect.Effect<void, Err, CurrentEditor>
        : Effect.gen(function* () {
            const editor = yield* CurrentEditor;
            yield* reverse({
              editor,
              input,
              output,
              restorePreviousDocument: () => restorePreviousDocument(output),
            });
          });

  const previous = (editor: { readonly state: EditorState }) =>
    capturePreviousContent(editor.state);

  const inputs = makeInputs(schema);
  const outputs = makeOutputs(schema);
  const applyRestorePreviousContent = (
    chain: Chain,
    _input: unknown,
    { previousContent }: PreviousContentOutput<S>,
  ) => chain.setContent(previousContent as JSONContent);

  const isSelectorPatchSpec = <Op extends string, In, Err>(
    spec: unknown,
  ): spec is SelectorDocumentPatchSpec<S, Op, In, Err> =>
    typeof spec === "object" && spec !== null && "select" in spec;

  const isEffectPatchSpec = <Op extends string, In, Extra extends Record<string, unknown>, Err>(
    spec: unknown,
  ): spec is EffectDocumentPatchSpec<S, Op, In, Extra, Err> =>
    typeof spec === "object" && spec !== null && "run" in spec;

  function patch<Op extends string, In>(
    spec: ChainDocumentPatchSpec<S, Op, In>,
  ): EditorCommand<Op, In, PreviousContentOutput<S>>;
  function patch<Op extends string, In, Extra extends Record<string, unknown>, Err = never>(
    spec: EffectDocumentPatchSpec<S, Op, In, Extra, Err>,
  ): Command<Op, In, PreviousContentOutput<S> & Extra, Err, CurrentEditor>;
  function patch<Op extends string, In, Err = DocumentSelectorError>(
    spec: SelectorDocumentPatchSpec<S, Op, In, Err>,
  ): Command<Op, In, SelectorPatchOutput<S>, Err | DocumentSelectorError, CurrentEditor>;
  function patch<Op extends string, In, Extra extends Record<string, unknown>, Err>(
    spec:
      | ChainDocumentPatchSpec<S, Op, In>
      | EffectDocumentPatchSpec<S, Op, In, Extra, Err>
      | SelectorDocumentPatchSpec<S, Op, In, Err>,
  ) {
    if (isSelectorPatchSpec(spec)) {
      return defineCommand<Op, In, SelectorPatchOutput<S>, Err | DocumentSelectorError, CurrentEditor>({
        op: spec.op,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: outputs.patch,
        forward: (input: In) =>
          Effect.gen(function* () {
            const editor = yield* CurrentEditor;
            const output = capturePreviousContent(editor.state);
            const selection = spec.select({ input });
            const matches = yield* selectMatches(
              editor.state.doc,
              selection.selector,
              selection.all,
            );
            const ordered = orderMatchesDescending(matches);
            let count: number;
            if (spec.applyMatches) {
              const result = yield* spec.applyMatches({
                editor,
                input,
                matches: ordered,
              });
              count = result ?? ordered.length;
            } else {
              for (const match of ordered) {
                const result = spec.applyMatch?.({ editor, input, match });
                if (result !== undefined) yield* result;
              }
              count = ordered.length;
            }
            return { ...output, count };
          }) as Effect.Effect<
            SelectorPatchOutput<S>,
            Err | DocumentSelectorError,
            CurrentEditor
          >,
        reverse: makePatchReverse<In, SelectorPatchOutput<S>, Err | DocumentSelectorError>(
          spec.reverse as DocumentPatchReverse<
            In,
            SelectorPatchOutput<S>,
            Err | DocumentSelectorError
          > | undefined,
        ),
        concurrencyPolicy: spec.concurrencyPolicy,
        transactional: spec.transactional,
      });
    }

    if (isEffectPatchSpec(spec)) {
      return defineCommand<Op, In, PreviousContentOutput<S> & Extra, Err, CurrentEditor>({
        op: spec.op,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: (spec.outputSchema ?? outputs.previousContent) as Schema.Schema<
          PreviousContentOutput<S> & Extra
        >,
        forward: (input: In) =>
          Effect.gen(function* () {
            const editor = yield* CurrentEditor;
            const output = capturePreviousContent(editor.state);
            const extra = yield* spec.run({ editor, input });
            return mergePreviousDocumentOutput(output, extra);
          }) as Effect.Effect<
            PreviousContentOutput<S> & Extra,
            Err,
            CurrentEditor
          >,
        reverse: makePatchReverse<In, PreviousContentOutput<S> & Extra, Err>(
          spec.reverse as DocumentPatchReverse<
            In,
            PreviousContentOutput<S> & Extra,
            Err
          > | undefined,
        ),
        concurrencyPolicy: spec.concurrencyPolicy,
        transactional: spec.transactional,
      });
    }

    const chainSpec = spec as ChainDocumentPatchSpec<S, Op, In>;
    return defineEditorCommand<Op, In, PreviousContentOutput<S>>({
      op: chainSpec.op,
      description: chainSpec.description,
      inputSchema: chainSpec.inputSchema,
      outputSchema: outputs.previousContent,
      reverseSetup: capturePreviousContent,
      apply: (chain, input) => chainSpec.apply({ chain, input }),
      applyReverse: applyRestorePreviousContent,
      capturesSelection: chainSpec.capturesSelection,
      coalesceKey: chainSpec.coalesceKey,
      coalesce: chainSpec.coalesce,
      concurrencyPolicy: chainSpec.concurrencyPolicy,
      transactional: chainSpec.transactional,
    });
  }

  const documentPatch = patch as DocumentPatchAuthoring<S>;

  return {
    patch: documentPatch,
    inputs,
    outputs,
    currentFromState,
  };
};
