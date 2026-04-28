import { Atom, Registry } from "@effect-atom/atom";
import { Editor as TiptapEditor, type JSONContent } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import type * as React from "react";
import { Data, Effect, Schema } from "effect";
import { CommandExecutor } from "./command-executor.js";
import { withoutPmHistory } from "./internal/strip-pm-history.js";
import { NodeViewStore } from "./react/node-view-store.js";
import { editorRuntime } from "./runtime.js";
import type { EditorSchema, NodeJSON } from "./schema/define.js";
import { TransactionBus } from "./transaction-bus.js";
import type { EditorId, TransactionSnapshot } from "./types.js";

export class EditorInitError extends Data.TaggedError("EditorInitError")<{
  readonly cause: unknown;
}> {}

type EditorSchemaNodes = Record<string, unknown>;
type EditorSchemaMarks = Record<string, unknown>;
type NodeViewDefinition = {
  readonly reactNodeView?: React.FC;
};

export interface EditorSpec<
  N extends EditorSchemaNodes = EditorSchemaNodes,
  M extends EditorSchemaMarks = EditorSchemaMarks,
> {
  readonly id: EditorId;
  readonly schema: EditorSchema<N, M>;
  readonly defaultContent: unknown;
  readonly extensions?: Extensions;
  readonly editable?: boolean;
  readonly editorProps?: Record<string, unknown>;
  readonly editableAtom?: Atom.Writable<boolean>;
}

export interface EditorHandle {
  readonly mount: (el: HTMLElement | null) => void;
  readonly _internal: {
    readonly editor: TiptapEditor;
    readonly nodeViewStore: NodeViewStore;
  };
}

const buildBaseExtensions = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  extra: Extensions | undefined,
): Extensions => {
  const all: Extensions = [...schema.tiptapExtensions, ...(extra ?? [])];
  return withoutPmHistory(all, { strict: true });
};

const makeSnapshot = (
  editorId: EditorId,
  transaction: { docChanged: boolean; selectionSet: boolean },
  state: unknown,
): TransactionSnapshot => ({
  editorId,
  docChanged: transaction.docChanged,
  selectionSet: transaction.selectionSet,
  stateAfter: state,
  transaction,
  sourceMeta: [],
  at: Date.now(),
});

interface EditorServices {
  readonly bus: TransactionBus;
  readonly executor: CommandExecutor;
}

interface TiptapTransactionEvent {
  readonly transaction: {
    readonly docChanged: boolean;
    readonly selectionSet: boolean;
  };
  readonly editor: TiptapEditor;
}

interface TiptapNodeViewInput {
  readonly node: {
    readonly type: { readonly name: string };
    readonly attrs: Record<string, unknown>;
  };
  readonly getPos: () => number | undefined;
  readonly view: unknown;
  readonly decorations: unknown;
}

const getEditorServices = Effect.gen(function* () {
  const bus = yield* TransactionBus;
  const executor = yield* CommandExecutor;
  return { bus, executor } satisfies EditorServices;
});

const decodeInitialContent = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
) =>
  Schema.decodeUnknown(spec.schema.Document)(
    spec.schema.migrate(spec.defaultContent),
  ).pipe(Effect.mapError((cause) => new EditorInitError({ cause })));

const withReactNodeViews = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  extensions: Extensions,
  nodeViewStore: NodeViewStore,
): Extensions =>
  extensions.map((extension) => {
    const name = (extension as { readonly name: string }).name;
    const definition = schema.nodes[name] as NodeViewDefinition | undefined;
    const Component = definition?.reactNodeView;
    if (!Component) return extension;

    return extension.extend({
      addNodeView() {
        return ({ node, getPos }: TiptapNodeViewInput) => {
          const dom = document.createElement("div");
          const key = nodeViewStore.nextKey();

          nodeViewStore.add({
            key,
            dom,
            contentDOM: null,
            Component,
            props: {
              nodeAttrs: node.attrs,
              nodeType: node.type.name,
              getPos,
              selected: false,
            },
          });

          return {
            dom,
            contentDOM: null,
            update(newNode: TiptapNodeViewInput["node"]) {
              nodeViewStore.update(key, {
                nodeAttrs: newNode.attrs,
                nodeType: newNode.type.name,
                getPos,
                selected: false,
              });
              return true;
            },
            destroy() {
              nodeViewStore.remove(key);
            },
          };
        };
      },
    });
  });

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
  );

const createTiptapEditor = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
  extensions: Extensions,
  content: NodeJSON,
): TiptapEditor =>
  new TiptapEditor({
    element: null,
    extensions,
    editable: spec.editable ?? true,
    content: content as JSONContent,
    ...(spec.editorProps === undefined ? {} : { editorProps: spec.editorProps }),
  });

const installTransactionSubscription = (
  editorId: EditorId,
  editor: TiptapEditor,
  bus: TransactionBus,
) =>
  Effect.gen(function* () {
    const handler = (props: TiptapTransactionEvent) => {
      Effect.runFork(
        bus.push(
          editorId,
          makeSnapshot(editorId, props.transaction, props.editor.state),
        ),
      );
    };

    editor.on("transaction", handler);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => editor.off("transaction", handler)),
    );
  });

const installEditableSubscription = (
  editor: TiptapEditor,
  editableAtom: Atom.Writable<boolean> | undefined,
) =>
  Effect.gen(function* () {
    if (editableAtom === undefined) return;

    const registry = yield* Registry.AtomRegistry;
    const unsubscribe = registry.subscribe(editableAtom, (editable) => {
      editor.setEditable(editable, false);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  });

const installEditorFinalizer = (
  editorId: EditorId,
  editor: TiptapEditor,
  services: EditorServices,
) =>
  Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* services.executor.interruptAllForEditor(editor);
      if (!editor.isDestroyed) editor.destroy();
      yield* services.bus.dispose(editorId);
    }),
  );

const makeEditorHandle = (
  editor: TiptapEditor,
  nodeViewStore: NodeViewStore,
): EditorHandle => ({
  mount: (el: HTMLElement | null) => {
    if (el) editor.mount(el);
    else editor.unmount();
  },
  _internal: { editor, nodeViewStore },
});

/**
 * Create the atom that owns a single Tiptap editor instance.
 *
 * - Validates `defaultContent` against `spec.schema.Document` at construction.
 * - Builds the editor with `element: null` (mounted via the returned handle).
 * - Wires exactly one `transaction` listener that pushes snapshots to the
 *   per-editor `TransactionBus`.
 * - Registers `editor.destroy()` as a Scope finalizer — runs exactly once on
 *   atom disposal.
 * - If `spec.editableAtom` is provided, subscribes imperatively so flipping
 *   the atom calls `editor.setEditable(x, false)` without rebuilding.
 */
export const makeEditorAtom = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  spec: EditorSpec<N, M>,
) =>
  editorRuntime.atom(
    Effect.gen(function* () {
      const services = yield* getEditorServices;
      const content = yield* decodeInitialContent(spec);
      const nodeViewStore = new NodeViewStore();
      const extensions = buildEditorExtensions(spec, nodeViewStore);
      const editor = createTiptapEditor(spec, extensions, content);

      yield* installTransactionSubscription(spec.id, editor, services.bus);
      yield* installEditableSubscription(editor, spec.editableAtom);
      yield* installEditorFinalizer(spec.id, editor, services);

      return makeEditorHandle(editor, nodeViewStore);
    }),
  );
