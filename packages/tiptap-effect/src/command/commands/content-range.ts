import type { JSONContent } from "@tiptap/core";
import { Data, Effect, Schema } from "effect";
import { defineCommand, defineEditorCommand } from "../command";
import { CurrentEditor } from "../internal/current-editor";

export class ContentPositionError extends Data.TaggedError(
  "ContentPositionError",
)<{
  readonly pos: number;
  readonly message: string;
}> {}

const ContentPatchOutput = Schema.Struct({
  previousContent: Schema.Unknown,
});

const RangeInput = {
  from: Schema.Number,
  to: Schema.Number,
};

/**
 * Insert arbitrary Tiptap JSON/string content at a concrete PM document
 * position. Undo restores the previous full document JSON.
 */
export const InsertContentAtCommand = defineEditorCommand({
  op: "tiptap-effect.content.insert-at",
  description: ({ pos }) => `Insert content at ${pos}`,
  inputSchema: Schema.Struct({
    pos: Schema.Number,
    content: Schema.Unknown,
  }),
  outputSchema: ContentPatchOutput,
  reverseSetup: (state, _input) => ({ previousContent: state.doc.toJSON() }),
  apply: (chain, { pos, content }) =>
    chain.insertContentAt(pos, content as JSONContent | string),
  applyReverse: (chain, _input, { previousContent }) =>
    chain.setContent(previousContent as JSONContent),
});

/**
 * Replace a concrete PM range with arbitrary Tiptap JSON/string content.
 * Undo restores the previous full document JSON.
 */
export const ReplaceRangeCommand = defineEditorCommand({
  op: "tiptap-effect.content.replace-range",
  description: ({ from, to }) => `Replace range ${from}-${to}`,
  inputSchema: Schema.Struct({
    ...RangeInput,
    content: Schema.Unknown,
  }),
  outputSchema: ContentPatchOutput,
  reverseSetup: (state, _input) => ({ previousContent: state.doc.toJSON() }),
  apply: (chain, { from, to, content }) =>
    chain.insertContentAt({ from, to }, content as JSONContent | string),
  applyReverse: (chain, _input, { previousContent }) =>
    chain.setContent(previousContent as JSONContent),
});

/**
 * Delete a concrete PM range. Undo restores the previous full document JSON.
 */
export const DeleteRangeCommand = defineEditorCommand({
  op: "tiptap-effect.content.delete-range",
  description: ({ from, to }) => `Delete range ${from}-${to}`,
  inputSchema: Schema.Struct(RangeInput),
  outputSchema: ContentPatchOutput,
  reverseSetup: (state, _input) => ({ previousContent: state.doc.toJSON() }),
  apply: (chain, { from, to }) => chain.deleteRange({ from, to }),
  applyReverse: (chain, _input, { previousContent }) =>
    chain.setContent(previousContent as JSONContent),
});

/**
 * Delete the node starting at a concrete PM position. NodeViews can pair this
 * with `useNodeViewProps().getPos()` without reaching for the raw editor.
 */
export const DeleteNodeAtCommand = defineCommand({
  op: "tiptap-effect.content.delete-node-at",
  description: ({ pos }) => `Delete node at ${pos}`,
  inputSchema: Schema.Struct({
    pos: Schema.Number,
  }),
  outputSchema: ContentPatchOutput,
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
      const previousContent = editor.state.doc.toJSON();
      editor
        .chain()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .run();
      return { previousContent };
    }),
  reverse: (_input, { previousContent }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      editor.commands.setContent(previousContent as JSONContent);
    }),
});

/**
 * Replace the node starting at a concrete PM position with Tiptap JSON/string
 * content. Useful for upload placeholders that resolve into media blocks.
 */
export const ReplaceNodeAtCommand = defineCommand({
  op: "tiptap-effect.content.replace-node-at",
  description: ({ pos }) => `Replace node at ${pos}`,
  inputSchema: Schema.Struct({
    pos: Schema.Number,
    content: Schema.Unknown,
  }),
  outputSchema: ContentPatchOutput,
  forward: ({ pos, content }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      const node = editor.state.doc.nodeAt(pos);
      if (!node) {
        return yield* Effect.fail(
          new ContentPositionError({
            pos,
            message: `No node found at position ${pos}`,
          }),
        );
      }
      const previousContent = editor.state.doc.toJSON();
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
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      editor.commands.setContent(previousContent as JSONContent);
    }),
});

/**
 * Merge attrs into the node at a concrete PM document position. Useful for
 * agentic/structural edits after a selector has resolved a match to `pos`.
 * Undo restores the previous full document JSON.
 */
export const UpdateNodeAttrsCommand = defineCommand({
  op: "tiptap-effect.content.update-node-attrs",
  description: ({ pos }) => `Update node attrs at ${pos}`,
  inputSchema: Schema.Struct({
    pos: Schema.Number,
    attrs: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
  outputSchema: Schema.Struct({
    previousContent: Schema.Unknown,
    previousAttrs: Schema.Unknown,
    nodeType: Schema.String,
  }),
  forward: ({ pos, attrs }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      const node = editor.state.doc.nodeAt(pos);
      if (!node) {
        return yield* Effect.fail(
          new ContentPositionError({
            pos,
            message: `No node found at position ${pos}`,
          }),
        );
      }
      const previousContent = editor.state.doc.toJSON();
      const previousAttrs = node.attrs;
      const tr = editor.state.tr.setNodeMarkup(
        pos,
        undefined,
        { ...node.attrs, ...attrs },
        node.marks,
      );
      editor.view.dispatch(tr);
      return { previousContent, previousAttrs, nodeType: node.type.name };
    }),
  reverse: (_input, { previousContent }) =>
    Effect.gen(function* () {
      const editor = yield* CurrentEditor;
      editor.commands.setContent(previousContent as JSONContent);
    }),
});
