import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { Data, Effect, Schema } from "effect";
import {
  defineCommand,
  defineEditorCommand,
  Reverse,
  type Command,
  type EditorCommand,
} from "./command";
import {
  findDocumentMatches,
  DocumentSelectorError,
  type DocumentMatch,
  type DocumentSelector,
} from "../document/selector";
import { CurrentEditor } from "./internal/current-editor";
import { DirtyTracker } from "../dirty/internal/tracker";
import type {
  AnyEditorSchema,
  AttrsOfNode,
  DocumentOf,
  InsertableContentOf,
  NodeNameOf,
} from "../schema/define";
import type { EditorId } from "../types";

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

type InsertContentAtInput<S extends AnyEditorSchema> = {
  readonly pos: number;
  readonly content: InsertableContentOf<S>;
};

type ReplaceRangeInput<S extends AnyEditorSchema> = {
  readonly from: number;
  readonly to: number;
  readonly content: InsertableContentOf<S>;
};

type ReplaceNodeAtInput<S extends AnyEditorSchema> = {
  readonly pos: number;
  readonly content: InsertableContentOf<S>;
};

type SelectorInput<S extends AnyEditorSchema> = {
  readonly selector: TypedNodeSelector<S>;
};

type SelectorManyInput<S extends AnyEditorSchema> = SelectorInput<S> & {
  readonly all?: boolean;
};

type SelectorInsertInput<S extends AnyEditorSchema> = SelectorInput<S> & {
  readonly content: InsertableContentOf<S>;
  readonly at?: "before" | "after" | "start" | "end";
};

type SelectorReplaceInput<S extends AnyEditorSchema> = SelectorManyInput<S> & {
  readonly content: InsertableContentOf<S>;
};

type PreviousContentOutput<S extends AnyEditorSchema> = {
  readonly previousContent: DocumentOf<S>;
};

type SelectorPatchOutput<S extends AnyEditorSchema> =
  PreviousContentOutput<S> & {
    readonly count: number;
  };

type UpdateAttrsAtOutput<S extends AnyEditorSchema> =
  PreviousContentOutput<S> & {
    readonly previousAttrs: unknown;
    readonly nodeType: string;
  };

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type HeadingChain<Chain> = Chain & {
  readonly toggleHeading: (attrs: { readonly level: HeadingLevel }) => Chain;
  readonly setHeading: (attrs: { readonly level: HeadingLevel }) => Chain;
  readonly setParagraph: () => Chain;
};

type ParagraphChain<Chain> = Chain & {
  readonly setParagraph: () => Chain;
  readonly toggleHeading?: (attrs: { readonly level: HeadingLevel }) => Chain;
};

type LinkChain<Chain> = Chain & {
  readonly setLink: (attrs: { readonly href: string }) => Chain;
  readonly unsetLink: () => Chain;
};

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

const previousContentOutputSchema = <S extends AnyEditorSchema>(
  schema: S,
): Schema.Schema<PreviousContentOutput<S>> =>
  Schema.Struct({
    previousContent: schema.Document,
  }) as Schema.Schema<PreviousContentOutput<S>>;

const selectorPatchOutputSchema = <S extends AnyEditorSchema>(
  schema: S,
): Schema.Schema<SelectorPatchOutput<S>> =>
  Schema.Struct({
    previousContent: schema.Document,
    count: Schema.Number,
  }) as Schema.Schema<SelectorPatchOutput<S>>;

const documentFromState = <S extends AnyEditorSchema>(
  state: EditorState,
): DocumentOf<S> => state.doc.toJSON() as DocumentOf<S>;

const restorePreviousContent = <S extends AnyEditorSchema>(
  previousContent: DocumentOf<S>,
) =>
  Effect.gen(function* () {
    const editor = yield* CurrentEditor;
    editor.commands.setContent(previousContent as JSONContent);
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

const inputSchemas = <S extends AnyEditorSchema>(schema: S) => {
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
    setContent: Schema.Struct({ content: schema.Document }) as Schema.Schema<{
      readonly content: DocumentOf<S>;
    }>,
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

export interface EditorCommands<S extends AnyEditorSchema> {
  readonly toggleMark: (
    markName: string,
  ) => EditorCommand<
    `tiptap-effect.mark.${string}.toggle`,
    void,
    { readonly wasActive: boolean; readonly from: number; readonly to: number }
  >;
  readonly insertText: EditorCommand<
    "tiptap-effect.insert.text",
    { readonly text: string },
    { readonly from: number; readonly length: number }
  >;
  readonly focus: EditorCommand<
    "tiptap-effect.focus",
    void,
    Record<string, never>
  >;
  readonly blur: EditorCommand<
    "tiptap-effect.blur",
    void,
    Record<string, never>
  >;
  readonly setHeading: EditorCommand<
    "tiptap-effect.set-heading",
    { readonly level: HeadingLevel },
    {
      readonly previousType: string;
      readonly previousLevel: number | null;
      readonly from: number;
      readonly to: number;
    }
  >;
  readonly setParagraph: EditorCommand<
    "tiptap-effect.set-paragraph",
    void,
    {
      readonly previousType: string;
      readonly previousLevel: number | null;
      readonly from: number;
      readonly to: number;
    }
  >;
  readonly setLink: EditorCommand<
    "tiptap-effect.set-link",
    { readonly href: string | null },
    {
      readonly previousHref: string | null;
      readonly from: number;
      readonly to: number;
    }
  >;
  readonly markSaved: (
    editorId: EditorId,
  ) => Command<
    "tiptap-effect.mark-saved",
    void,
    { readonly savedJSON: DocumentOf<S> },
    never,
    CurrentEditor | DirtyTracker
  >;
  readonly setContent: EditorCommand<
    "tiptap-effect.set-content",
    { readonly content: DocumentOf<S> },
    PreviousContentOutput<S>
  >;
  readonly clearContent: EditorCommand<
    "tiptap-effect.clear-content",
    void,
    PreviousContentOutput<S>
  >;
  readonly insertContentAt: EditorCommand<
    "tiptap-effect.content.insert-at",
    InsertContentAtInput<S>,
    PreviousContentOutput<S>
  >;
  readonly replaceRange: EditorCommand<
    "tiptap-effect.content.replace-range",
    ReplaceRangeInput<S>,
    PreviousContentOutput<S>
  >;
  readonly deleteRange: EditorCommand<
    "tiptap-effect.content.delete-range",
    { readonly from: number; readonly to: number },
    PreviousContentOutput<S>
  >;
  readonly deleteNodeAt: Command<
    "tiptap-effect.content.delete-node-at",
    { readonly pos: number },
    PreviousContentOutput<S>,
    ContentPositionError,
    CurrentEditor
  >;
  readonly replaceNodeAt: Command<
    "tiptap-effect.content.replace-node-at",
    ReplaceNodeAtInput<S>,
    PreviousContentOutput<S>,
    ContentPositionError,
    CurrentEditor
  >;
  readonly updateNodeAttrsAt: Command<
    "tiptap-effect.content.update-node-attrs",
    UpdateNodeAttrsAtInput<S>,
    UpdateAttrsAtOutput<S>,
    ContentPositionError | EditorCommandError,
    CurrentEditor
  >;
  readonly insertContentAtMatch: Command<
    "tiptap-effect.selector.insert-at-match",
    SelectorInsertInput<S>,
    SelectorPatchOutput<S>,
    DocumentSelectorError,
    CurrentEditor
  >;
  readonly replaceMatches: Command<
    "tiptap-effect.selector.replace",
    SelectorReplaceInput<S>,
    SelectorPatchOutput<S>,
    DocumentSelectorError,
    CurrentEditor
  >;
  readonly deleteMatches: Command<
    "tiptap-effect.selector.delete",
    SelectorManyInput<S>,
    SelectorPatchOutput<S>,
    DocumentSelectorError,
    CurrentEditor
  >;
  readonly updateNodeAttrsBySelector: Command<
    "tiptap-effect.selector.update-node-attrs",
    UpdateNodeAttrsBySelectorInput<S>,
    SelectorPatchOutput<S>,
    DocumentSelectorError,
    CurrentEditor
  >;
  readonly findMatches: Command<
    "tiptap-effect.selector.find",
    SelectorInput<S>,
    ReadonlyArray<DocumentMatch>,
    never,
    CurrentEditor
  >;
}

export interface EditorCommandHelpers<S extends AnyEditorSchema> {
  readonly documentFromState: (state: EditorState) => DocumentOf<S>;
}

export interface EditorCommandFactoryContext<S extends AnyEditorSchema> {
  readonly schema: S;
  readonly command: typeof defineCommand;
  readonly editorCommand: typeof defineEditorCommand;
  readonly helpers: EditorCommandHelpers<S>;
}

export class EditorCommandCollisionError extends Error {
  constructor(readonly keys: ReadonlyArray<string>) {
    super(
      `Editor command keys collide with built-ins: ${keys.join(", ")}`,
    );
    this.name = "EditorCommandCollisionError";
  }
}

export interface EditorCommandOptions<
  S extends AnyEditorSchema,
  Custom extends Record<string, unknown>,
> {
  readonly commands?: (context: EditorCommandFactoryContext<S>) => Custom;
}

const builtInKeys = [
  "toggleMark",
  "insertText",
  "focus",
  "blur",
  "setHeading",
  "setParagraph",
  "setLink",
  "markSaved",
  "setContent",
  "clearContent",
  "insertContentAt",
  "replaceRange",
  "deleteRange",
  "deleteNodeAt",
  "replaceNodeAt",
  "updateNodeAttrsAt",
  "insertContentAtMatch",
  "replaceMatches",
  "deleteMatches",
  "updateNodeAttrsBySelector",
  "findMatches",
] as const;

export const defineEditorCommands = <
  const S extends AnyEditorSchema,
  Custom extends Record<string, unknown> = {},
>(
  schema: S,
  options: EditorCommandOptions<S, Custom> = {},
): EditorCommands<S> & Custom => {
  const inputs = inputSchemas(schema);
  const previousOutput = previousContentOutputSchema(schema);
  const patchOutput = selectorPatchOutputSchema(schema);

  const builtIns: EditorCommands<S> = {
    toggleMark: (markName: string) =>
      defineEditorCommand({
        op: `tiptap-effect.mark.${markName}.toggle` as const,
        description: () => `Toggle ${markName}`,
        inputSchema: Schema.Void,
        outputSchema: Schema.Struct({
          wasActive: Schema.Boolean,
          from: Schema.Number,
          to: Schema.Number,
        }),
        capturesSelection: true,
        apply: (chain, _input) => chain.toggleMark(markName),
        reverseSetup: (state, _input) => {
          const markType = state.schema.marks[markName];
          const wasActive = !markType
            ? false
            : state.selection.empty
              ? (
                  state.storedMarks ??
                  state.selection.$from?.marks?.() ??
                  []
                ).some((m) => m.type.name === markName)
              : state.doc.rangeHasMark(
                  state.selection.from,
                  state.selection.to,
                  markType,
                );
          return {
            wasActive,
            from: state.selection.from,
            to: state.selection.to,
          };
        },
        applyReverse: (chain, _input, { from, to, wasActive }) =>
          wasActive
            ? chain.setTextSelection({ from, to }).setMark(markName)
            : chain.setTextSelection({ from, to }).unsetMark(markName),
      }),
    insertText: defineEditorCommand({
      op: "tiptap-effect.insert.text",
      description: ({ text }) => `Insert "${text}"`,
      inputSchema: Schema.Struct({ text: Schema.String }),
      outputSchema: Schema.Struct({
        from: Schema.Number,
        length: Schema.Number,
      }),
      apply: (chain, { text }) => chain.insertContent(text),
      reverseSetup: (state, { text }) => ({
        from: state.selection.from,
        length: text.length,
      }),
      applyReverse: (chain, _input, { from, length }) =>
        chain.deleteRange({ from, to: from + length }),
      capturesSelection: true,
      coalesceKey: ({ text }) =>
        `insert-text:${text.length === 1 ? "char" : "block"}`,
      coalesce: (prev, next) => {
        if (next.output.from !== prev.output.from + prev.output.length)
          return null;
        return {
          input: { text: prev.input.text + next.input.text },
          output: {
            from: prev.output.from,
            length: prev.output.length + next.output.length,
          },
        };
      },
    }),
    focus: defineEditorCommand({
      op: "tiptap-effect.focus",
      description: () => "Focus editor",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      apply: (chain, _input) => chain.focus(),
      applyReverse: (chain, _input, _captured) => chain.blur(),
      reverseSetup: () => ({}),
    }),
    blur: defineEditorCommand({
      op: "tiptap-effect.blur",
      description: () => "Blur editor",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({}),
      apply: (chain, _input) => chain.blur(),
      applyReverse: (chain, _input, _captured) => chain.focus(),
      reverseSetup: () => ({}),
    }),
    setHeading: defineEditorCommand({
      op: "tiptap-effect.set-heading",
      description: ({ level }) => `Toggle heading H${level}`,
      inputSchema: Schema.Struct({
        level: Schema.Literal(1, 2, 3, 4, 5, 6),
      }),
      outputSchema: Schema.Struct({
        previousType: Schema.String,
        previousLevel: Schema.Union(Schema.Number, Schema.Null),
        from: Schema.Number,
        to: Schema.Number,
      }),
      capturesSelection: true,
      apply: (chain, { level }) =>
        (chain.focus() as HeadingChain<typeof chain>).toggleHeading({ level }),
      reverseSetup: (state, _input) => {
        const node = state.selection.$from.parent;
        return {
          previousType: node?.type?.name ?? "paragraph",
          previousLevel: node?.attrs?.level ?? null,
          from: state.selection.from,
          to: state.selection.to,
        };
      },
      applyReverse: (
        chain,
        _input,
        { previousType, previousLevel, from, to },
      ) => {
        const restored = chain
          .focus()
          .setTextSelection({ from, to }) as HeadingChain<typeof chain>;
        if (previousType === "heading" && previousLevel !== null) {
          return restored.setHeading({ level: previousLevel as HeadingLevel });
        }
        return restored.setParagraph();
      },
    }),
    setParagraph: defineEditorCommand({
      op: "tiptap-effect.set-paragraph",
      description: () => "Set paragraph",
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({
        previousType: Schema.String,
        previousLevel: Schema.Union(Schema.Number, Schema.Null),
        from: Schema.Number,
        to: Schema.Number,
      }),
      capturesSelection: true,
      apply: (chain) =>
        (chain.focus() as ParagraphChain<typeof chain>).setParagraph(),
      reverseSetup: (state) => {
        const node = state.selection.$from.parent;
        return {
          previousType: node?.type?.name ?? "paragraph",
          previousLevel: node?.attrs?.level ?? null,
          from: state.selection.from,
          to: state.selection.to,
        };
      },
      applyReverse: (
        chain,
        _input,
        { previousType, previousLevel, from, to },
      ) => {
        const restored = chain
          .focus()
          .setTextSelection({ from, to }) as ParagraphChain<typeof chain>;
        if (
          previousType === "heading" &&
          previousLevel !== null &&
          restored.toggleHeading
        ) {
          return restored.toggleHeading({
            level: previousLevel as HeadingLevel,
          });
        }
        return restored.setParagraph();
      },
    }),
    setLink: defineEditorCommand({
      op: "tiptap-effect.set-link",
      description: ({ href }) =>
        href === null ? "Remove link" : `Set link -> ${href}`,
      inputSchema: Schema.Struct({
        href: Schema.Union(Schema.String, Schema.Null),
      }),
      outputSchema: Schema.Struct({
        previousHref: Schema.Union(Schema.String, Schema.Null),
        from: Schema.Number,
        to: Schema.Number,
      }),
      capturesSelection: true,
      apply: (chain, { href }) => {
        const c = chain.focus() as LinkChain<typeof chain>;
        if (href === null) return c.unsetLink();
        return c.setLink({ href });
      },
      reverseSetup: (state, _input) => {
        const linkMarkType = state.schema.marks.link;
        let previousHref: string | null = null;
        if (linkMarkType) {
          const marks = state.selection.$from.marks?.() ?? [];
          const link = marks.find((m) => m.type.name === "link");
          previousHref = link?.attrs?.href ?? null;
        }
        return {
          previousHref,
          from: state.selection.from,
          to: state.selection.to,
        };
      },
      applyReverse: (chain, _input, { previousHref, from, to }) => {
        const c = chain.focus().setTextSelection({ from, to }) as LinkChain<
          typeof chain
        >;
        if (previousHref === null) return c.unsetLink();
        return c.setLink({ href: previousHref });
      },
    }),
    markSaved: (editorId: EditorId) =>
      defineCommand({
        op: "tiptap-effect.mark-saved" as const,
        description: () => "Mark saved",
        inputSchema: Schema.Void,
        outputSchema: Schema.Struct({
          savedJSON: schema.Document,
        }) as Schema.Schema<{
          readonly savedJSON: DocumentOf<S>;
        }>,
        forward: () =>
          Effect.gen(function* () {
            const editor = yield* CurrentEditor;
            const tracker = yield* DirtyTracker;
            const json = documentFromState<S>(editor.state);
            yield* tracker.markSaved(editorId, json);
            return { savedJSON: json };
          }),
        reverse: Reverse.skipOnUndo,
      }),
    setContent: defineEditorCommand({
      op: "tiptap-effect.set-content",
      description: () => "Replace document content",
      inputSchema: inputs.setContent,
      outputSchema: previousOutput,
      apply: (chain, { content }) => chain.setContent(content as JSONContent),
      reverseSetup: (state, _input) => ({
        previousContent: documentFromState<S>(state),
      }),
      applyReverse: (chain, _input, { previousContent }) =>
        chain.setContent(previousContent as JSONContent),
    }),
    clearContent: defineEditorCommand({
      op: "tiptap-effect.clear-content",
      description: () => "Clear document",
      inputSchema: Schema.Void,
      outputSchema: previousOutput,
      apply: (chain, _input) => chain.clearContent(true),
      reverseSetup: (state, _input) => ({
        previousContent: documentFromState<S>(state),
      }),
      applyReverse: (chain, _input, { previousContent }) =>
        chain.setContent(previousContent as JSONContent),
    }),
    insertContentAt: defineEditorCommand({
      op: "tiptap-effect.content.insert-at",
      description: ({ pos }) => `Insert content at ${pos}`,
      inputSchema: inputs.insertContentAt,
      outputSchema: previousOutput,
      reverseSetup: (state, _input) => ({
        previousContent: documentFromState<S>(state),
      }),
      apply: (chain, { pos, content }) =>
        chain.insertContentAt(pos, content as JSONContent | string),
      applyReverse: (chain, _input, { previousContent }) =>
        chain.setContent(previousContent as JSONContent),
    }),
    replaceRange: defineEditorCommand({
      op: "tiptap-effect.content.replace-range",
      description: ({ from, to }) => `Replace range ${from}-${to}`,
      inputSchema: inputs.replaceRange,
      outputSchema: previousOutput,
      reverseSetup: (state, _input) => ({
        previousContent: documentFromState<S>(state),
      }),
      apply: (chain, { from, to, content }) =>
        chain.insertContentAt({ from, to }, content as JSONContent | string),
      applyReverse: (chain, _input, { previousContent }) =>
        chain.setContent(previousContent as JSONContent),
    }),
    deleteRange: defineEditorCommand({
      op: "tiptap-effect.content.delete-range",
      description: ({ from, to }) => `Delete range ${from}-${to}`,
      inputSchema: Schema.Struct({
        from: Schema.Number,
        to: Schema.Number,
      }),
      outputSchema: previousOutput,
      reverseSetup: (state, _input) => ({
        previousContent: documentFromState<S>(state),
      }),
      apply: (chain, { from, to }) => chain.deleteRange({ from, to }),
      applyReverse: (chain, _input, { previousContent }) =>
        chain.setContent(previousContent as JSONContent),
    }),
    deleteNodeAt: defineCommand({
      op: "tiptap-effect.content.delete-node-at",
      description: ({ pos }) => `Delete node at ${pos}`,
      inputSchema: Schema.Struct({
        pos: Schema.Number,
      }),
      outputSchema: previousOutput,
      forward: ({ pos }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const node = editor.state.doc.nodeAt(pos);
          if (!node) {
            return yield* new ContentPositionError({
              pos,
              message: `No node found at position ${pos}`,
            });
          }
          const previousContent = documentFromState<S>(editor.state);
          editor
            .chain()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .run();
          return { previousContent };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    replaceNodeAt: defineCommand({
      op: "tiptap-effect.content.replace-node-at",
      description: ({ pos }) => `Replace node at ${pos}`,
      inputSchema: inputs.replaceNodeAt,
      outputSchema: previousOutput,
      forward: ({ pos, content }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const node = editor.state.doc.nodeAt(pos);
          if (!node) {
            return yield* new ContentPositionError({
              pos,
              message: `No node found at position ${pos}`,
            });
          }
          const previousContent = documentFromState<S>(editor.state);
          editor
            .chain()
            .insertContentAt(
              { from: pos, to: pos + node.nodeSize },
              content as JSONContent | string,
            )
            .run();
          return { previousContent };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    updateNodeAttrsAt: defineCommand({
      op: "tiptap-effect.content.update-node-attrs",
      description: ({ pos, type }) => `Update ${type} attrs at ${pos}`,
      inputSchema: inputs.updateAttrsAt,
      outputSchema: Schema.Struct({
        previousContent: schema.Document,
        previousAttrs: Schema.Unknown,
        nodeType: Schema.String,
      }) as Schema.Schema<UpdateAttrsAtOutput<S>>,
      forward: ({ pos, type, attrs }) =>
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
          const previousContent = documentFromState<S>(editor.state);
          const previousAttrs = node.attrs;
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(
              pos,
              undefined,
              { ...node.attrs, ...attrs },
              node.marks,
            ),
          );
          return { previousContent, previousAttrs, nodeType: node.type.name };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    insertContentAtMatch: defineCommand({
      op: "tiptap-effect.selector.insert-at-match",
      description: ({ selector, at = "after" }) =>
        `Insert content ${at} selector ${selector.type ?? "*"}`,
      inputSchema: inputs.selectorInsert,
      outputSchema: patchOutput,
      forward: ({ selector, content, at = "after" }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const previousContent = documentFromState<S>(editor.state);
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
          return { previousContent, count: 1 };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    replaceMatches: defineCommand({
      op: "tiptap-effect.selector.replace",
      description: ({ selector }) => `Replace selector ${selector.type ?? "*"}`,
      inputSchema: inputs.selectorReplace,
      outputSchema: patchOutput,
      forward: ({ selector, content, all }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const previousContent = documentFromState<S>(editor.state);
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
          return { previousContent, count: matches.length };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    deleteMatches: defineCommand({
      op: "tiptap-effect.selector.delete",
      description: ({ selector }) => `Delete selector ${selector.type ?? "*"}`,
      inputSchema: inputs.selectorMany,
      outputSchema: patchOutput,
      forward: ({ selector, all }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const previousContent = documentFromState<S>(editor.state);
          const matches = yield* selectMatches(
            editor.state.doc,
            selector as DocumentSelector,
            all,
          );
          for (const match of [...matches].sort((a, b) => b.from - a.from)) {
            editor.commands.deleteRange({ from: match.from, to: match.to });
          }
          return { previousContent, count: matches.length };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    updateNodeAttrsBySelector: defineCommand({
      op: "tiptap-effect.selector.update-node-attrs",
      description: ({ selector }) =>
        `Update attrs for selector ${selector.type}`,
      inputSchema: inputs.updateBySelector,
      outputSchema: patchOutput,
      forward: ({ selector, attrs, all }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const previousContent = documentFromState<S>(editor.state);
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
          return { previousContent, count: matches.length };
        }),
      reverse: (_input, { previousContent }) =>
        restorePreviousContent<S>(previousContent),
    }),
    findMatches: defineCommand({
      op: "tiptap-effect.selector.find",
      description: ({ selector }) => `Find selector ${selector.type ?? "*"}`,
      inputSchema: inputs.selector,
      outputSchema: Schema.Array(
        Schema.Struct({
          pos: Schema.Number,
          from: Schema.Number,
          to: Schema.Number,
          size: Schema.Number,
          nodeType: Schema.String,
          attrs: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
          text: Schema.String,
        }),
      ) as Schema.Schema<ReadonlyArray<DocumentMatch>>,
      forward: ({ selector }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          return findDocumentMatches(
            editor.state.doc,
            selector as DocumentSelector,
          );
        }),
      reverse: Reverse.skipOnUndo,
    }),
  };

  const custom =
    options.commands?.({
      schema,
      command: defineCommand,
      editorCommand: defineEditorCommand,
      helpers: {
        documentFromState: (state) => documentFromState<S>(state),
      },
    }) ?? ({} as Custom);

  const collisions = Object.keys(custom).filter((key) =>
    (builtInKeys as ReadonlyArray<string>).includes(key),
  );
  if (collisions.length > 0) {
    throw new EditorCommandCollisionError(collisions);
  }

  return {
    ...builtIns,
    ...custom,
  };
};
