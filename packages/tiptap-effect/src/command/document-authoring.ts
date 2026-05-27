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
  DocumentOf,
} from "../schema/define";
import { CurrentEditor } from "./internal/current-editor";
import {
  capturePreviousDocument,
  currentDocumentFromState,
  mergePreviousDocumentOutput,
  orderMatchesDescending,
  restoreDocumentSnapshot,
} from "./internal/document-patch-contract";
import {
  makeDocumentPatchSchemas,
  type DocumentPatchSchemas,
  type PreviousContentOutput,
  type SelectorPatchOutput,
} from "./internal/document-patch-schemas";

export type {
  DeleteRangeInput,
  InsertContentAtInput,
  PreviousContentOutput,
  ReplaceNodeAtInput,
  ReplaceRangeInput,
  SelectorInput,
  SelectorInsertInput,
  SelectorManyInput,
  SelectorPatchOutput,
  SelectorReplaceInput,
  SetContentInput,
  TypedNodeSelector,
  TypedNodeSelectorWithType,
  UpdateAttrsAtOutput,
  UpdateNodeAttrsAtInput,
  UpdateNodeAttrsBySelectorInput,
} from "./internal/document-patch-schemas";

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

export interface DocumentCommandAuthoring<S extends AnyEditorSchema> {
  /**
   * Helpers for defining Commands that mutate document content and undo by
   * restoring the previous typed document.
   */
  readonly patch: DocumentPatchAuthoring<S>;
  readonly inputs: DocumentPatchSchemas<S>["inputs"];
  readonly outputs: DocumentPatchSchemas<S>["outputs"];
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

  const restorePreviousContent = Effect.fnUntraced(function* (
    _input: unknown,
    { previousContent }: PreviousContentOutput<S>,
  ) {
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
    Effect.fnUntraced(function* (input: In, output: Out) {
      if (reverse === undefined) {
        yield* restorePreviousDocument(output) as Effect.Effect<void, Err, CurrentEditor>;
        return;
      }

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

  const { inputs, outputs } = makeDocumentPatchSchemas(schema);
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
        forward: Effect.fnUntraced(function* (input: In) {
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
        }) as (input: In) => Effect.Effect<
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
        forward: Effect.fnUntraced(function* (input: In) {
          const editor = yield* CurrentEditor;
          const output = capturePreviousContent(editor.state);
          const extra = yield* spec.run({ editor, input });
          return mergePreviousDocumentOutput(output, extra);
        }) as (input: In) => Effect.Effect<
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
