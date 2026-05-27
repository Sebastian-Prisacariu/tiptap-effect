import type { JSONContent } from "@tiptap/core";
import { Effect, Schema } from "effect";
import {
  defineCommand,
  defineEditorCommand,
  Reverse,
  type Command,
  type EditorCommand,
} from "./command";
import {
  DocumentSelectorError,
  type DocumentMatch,
  type DocumentSelector,
} from "../document/selector";
import { CurrentEditor } from "./internal/current-editor";
import { DirtyTracker } from "../dirty/internal/tracker";
import type { AnyEditorSchema, DocumentOf } from "../schema/define";
import type { EditorId } from "../types";
import {
  makeDocumentCommandAuthoring,
  ContentPositionError,
  type DeleteRangeInput,
  type DocumentCommandAuthoring,
  EditorCommandError,
  type InsertContentAtInput,
  type PreviousContentOutput,
  type ReplaceNodeAtInput,
  type ReplaceRangeInput,
  type SelectorInput,
  type SelectorInsertInput,
  type SelectorManyInput,
  type SelectorPatchOutput,
  type SelectorReplaceInput,
  type SetContentInput,
  type UpdateAttrsAtOutput,
  type UpdateNodeAttrsAtInput,
  type UpdateNodeAttrsBySelectorInput,
} from "./document-authoring";

export {
  ContentPositionError,
  EditorCommandError,
  type DocumentCommandAuthoring,
  type DocumentPatchAuthoring,
  type BaseDocumentPatchSpec,
  type EditorDocumentPatchSpec,
  type EffectDocumentPatchSpec,
  type SelectorDocumentPatchSpec,
  type PreviousContentOutput,
  type SelectorPatchOutput,
  type TypedNodeSelector,
  type TypedNodeSelectorWithType,
  type UpdateAttrsAtOutput,
  type UpdateNodeAttrsAtInput,
  type UpdateNodeAttrsBySelectorInput,
} from "./document-authoring";

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
    SetContentInput<S>,
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
    DeleteRangeInput,
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

export interface EditorCommandFactoryContext<S extends AnyEditorSchema> {
  readonly schema: S;
  readonly command: typeof defineCommand;
  readonly editorCommand: typeof defineEditorCommand;
  readonly document: DocumentCommandAuthoring<S>;
}

export class EditorCommandCollisionError extends Error {
  constructor(readonly keys: ReadonlyArray<string>) {
    super(`Editor command keys collide with built-ins: ${keys.join(", ")}`);
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
  const document = makeDocumentCommandAuthoring(schema);
  const patch = document.patch;

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
            const json = document.currentFromState(editor.state);
            yield* tracker.markSaved(editorId, json);
            return { savedJSON: json };
          }),
        reverse: Reverse.skipOnUndo,
      }),
    setContent: patch.editorCommand({
      op: "tiptap-effect.set-content",
      description: () => "Replace document content",
      inputSchema: document.inputs.setContent,
      apply: (chain, { content }) => chain.setContent(content as JSONContent),
    }),
    clearContent: patch.editorCommand({
      op: "tiptap-effect.clear-content",
      description: () => "Clear document",
      inputSchema: Schema.Void,
      apply: (chain, _input) => chain.clearContent(true),
    }),
    insertContentAt: patch.editorCommand({
      op: "tiptap-effect.content.insert-at",
      description: ({ pos }) => `Insert content at ${pos}`,
      inputSchema: document.inputs.insertContentAt,
      apply: (chain, { pos, content }) =>
        chain.insertContentAt(pos, content as JSONContent | string),
    }),
    replaceRange: patch.editorCommand({
      op: "tiptap-effect.content.replace-range",
      description: ({ from, to }) => `Replace range ${from}-${to}`,
      inputSchema: document.inputs.replaceRange,
      apply: (chain, { from, to, content }) =>
        chain.insertContentAt({ from, to }, content as JSONContent | string),
    }),
    deleteRange: patch.editorCommand({
      op: "tiptap-effect.content.delete-range",
      description: ({ from, to }) => `Delete range ${from}-${to}`,
      inputSchema: Schema.Struct({
        from: Schema.Number,
        to: Schema.Number,
      }),
      apply: (chain, { from, to }) => chain.deleteRange({ from, to }),
    }),
    deleteNodeAt: patch.command({
      op: "tiptap-effect.content.delete-node-at",
      description: ({ pos }) => `Delete node at ${pos}`,
      inputSchema: Schema.Struct({
        pos: Schema.Number,
      }),
      apply: ({ pos }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const node = editor.state.doc.nodeAt(pos);
          if (!node) {
            return yield* new ContentPositionError({
              pos,
              message: `No node found at position ${pos}`,
            });
          }
          editor
            .chain()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .run();
        }),
    }),
    replaceNodeAt: patch.command({
      op: "tiptap-effect.content.replace-node-at",
      description: ({ pos }) => `Replace node at ${pos}`,
      inputSchema: document.inputs.replaceNodeAt,
      apply: ({ pos, content }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const node = editor.state.doc.nodeAt(pos);
          if (!node) {
            return yield* new ContentPositionError({
              pos,
              message: `No node found at position ${pos}`,
            });
          }
          editor
            .chain()
            .insertContentAt(
              { from: pos, to: pos + node.nodeSize },
              content as JSONContent | string,
            )
            .run();
        }),
    }),
    updateNodeAttrsAt: defineCommand({
      op: "tiptap-effect.content.update-node-attrs",
      description: ({ pos, type }) => `Update ${type} attrs at ${pos}`,
      inputSchema: document.inputs.updateAttrsAt,
      outputSchema: document.outputs.updateAttrsAt,
      forward: document.updateNodeAttrsAt,
      reverse: document.restorePreviousContent,
    }),
    insertContentAtMatch: patch.selectorCommand({
      op: "tiptap-effect.selector.insert-at-match",
      description: ({ selector, at = "after" }) =>
        `Insert content ${at} selector ${selector.type ?? "*"}`,
      inputSchema: document.inputs.selectorInsert,
      apply: ({ selector, content, at = "after" }) =>
        Effect.gen(function* () {
          const editor = yield* CurrentEditor;
          const matches = yield* patch.selectMatches(
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
          return 1;
        }),
    }),
    replaceMatches: patch.selectorCommand({
      op: "tiptap-effect.selector.replace",
      description: ({ selector }) => `Replace selector ${selector.type ?? "*"}`,
      inputSchema: document.inputs.selectorReplace,
      apply: patch.applyReplaceMatches,
    }),
    deleteMatches: patch.selectorCommand({
      op: "tiptap-effect.selector.delete",
      description: ({ selector }) => `Delete selector ${selector.type ?? "*"}`,
      inputSchema: document.inputs.selectorMany,
      apply: patch.applyDeleteMatches,
    }),
    updateNodeAttrsBySelector: defineCommand({
      op: "tiptap-effect.selector.update-node-attrs",
      description: ({ selector }) =>
        `Update attrs for selector ${selector.type}`,
      inputSchema: document.inputs.updateBySelector,
      outputSchema: document.outputs.patch,
      forward: document.updateNodeAttrsBySelector,
      reverse: document.restorePreviousContent,
    }),
    findMatches: defineCommand({
      op: "tiptap-effect.selector.find",
      description: ({ selector }) => `Find selector ${selector.type ?? "*"}`,
      inputSchema: document.inputs.selector,
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
      forward: document.findMatches,
      reverse: Reverse.skipOnUndo,
    }),
  };

  const custom =
    options.commands?.({
      schema,
      command: defineCommand,
      editorCommand: defineEditorCommand,
      document,
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
