/**
 * Type-only tests for the locked-down public API.
 *
 * These assertions run during `tsc --noEmit`. They verify that:
 *   1. `useRawEditor()` (no arg) is a TS error.
 *   2. `useRawEditor({ unsafe: true })` is allowed.
 *   3. No public hook (other than useRawEditor) returns an object with an
 *      `editor` field.
 *   4. `Reverse` exposes only the two sentinels.
 */
import type { Atom } from "@effect-atom/atom"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Selection as ProseMirrorSelection } from "@tiptap/pm/state"
import { Effect, Schema } from "effect"
import {
  defineCommand,
  defineEditorSchema,
  Reverse,
  selectedNodeAtom,
  selectionAtom,
  Sequence,
  useNodeViewProps,
  useRawEditor,
  type SelectedNodeInfo,
} from "../src"
import { BoldMark } from "../src/schema/marks"
import {
  DocNode,
  HeadingNode,
  ParagraphNode,
  TextNode,
} from "../src/schema/nodes"
import type {
  Command,
  CommandApplicationError,
  CurrentEditor,
  EditorCommand,
  ReverseKind,
  useDispatch,
  useHistory,
} from "../src"
import { EditorId } from "../src"

type AtomValue<A> = A extends Atom.Atom<infer T> ? T : never

// 1) useRawEditor() with no arg — must be a type error
declare const _raw_no_arg_should_error: ReturnType<typeof useRawEditor>
// @ts-expect-error -- the unsafe-token argument is required
useRawEditor()

// 2) useRawEditor({ unsafe: true }) — allowed; returns Editor or null
declare const _raw_with_token: () => Editor | null
type Editor = TiptapEditor
const _raw_ok: () => Editor | null = () => useRawEditor({ unsafe: true })
void _raw_ok

// 3) useDispatch / useHistory return shapes — must NOT contain `editor`
type DispatchReturn = ReturnType<typeof useDispatch>
type HistoryReturn = ReturnType<typeof useHistory>

type _NoEditorOnDispatchReturn = DispatchReturn extends { editor: unknown } ? never : "ok"
type _NoEditorOnHistoryReturn = HistoryReturn extends { editor: unknown } ? never : "ok"
const _check1: _NoEditorOnDispatchReturn = "ok"
const _check2: _NoEditorOnHistoryReturn = "ok"
void _check1
void _check2

// 4) Reverse sentinel values — only two allowed
type _ReverseKind = ReverseKind
type _ExpectKinds =
  | "tiptap-effect/Reverse/NotReversible"
  | "tiptap-effect/Reverse/SkipOnUndo"
type _KindMatches = _ReverseKind extends _ExpectKinds
  ? _ExpectKinds extends _ReverseKind
    ? "ok"
    : "missing-kind"
  : "extra-kind"
const _check3: _KindMatches = "ok"
void _check3

// 5) Command and EditorCommand parity — every EditorCommand is a Command
type _EditorIsCommand = EditorCommand<"x", void, {}> extends Command<
  "x",
  void,
  {},
  CommandApplicationError,
  CurrentEditor
>
  ? "ok"
  : "fail"
const _check4: _EditorIsCommand = "ok"
void _check4

// Also confirm Reverse is a value-level export with the expected shape
type _ReverseHasSentinels = "notReversible" extends keyof typeof Reverse
  ? "skipOnUndo" extends keyof typeof Reverse
    ? "ok"
    : "missing-skip"
  : "missing-notReversible"
const _check5: _ReverseHasSentinels = "ok"
void _check5

// 6) Sequence.atomic accepts EditorCommand only at the type level. A plain
// Command (not built via defineEditorCommand, no `_editorCommand: true` brand)
// must be rejected.
const _PlainCmd = defineCommand({
  op: "x.plain",
  description: () => "plain",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  forward: () => Effect.succeed({}),
  reverse: Reverse.notReversible,
})

// @ts-expect-error -- Sequence.atomic rejects plain Command at the type level
Sequence.atomic("seq.x", [_PlainCmd] as const, () => "")
void _PlainCmd

// 7) Schema Document content is the registered node union.
const _lockedSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode, heading: HeadingNode },
  marks: { bold: BoldMark },
})
type _Document = typeof _lockedSchema.Document.Type
type _DocumentContent = NonNullable<_Document["content"]>[number]
type _DocumentContentTypes = _DocumentContent["type"]
type _ExpectedContentTypes = "paragraph" | "heading" | "text"
type _ContentUnionMatches = _DocumentContentTypes extends _ExpectedContentTypes
  ? _ExpectedContentTypes extends _DocumentContentTypes
    ? "ok"
    : "missing-node"
  : "extra-node"
const _check6: _ContentUnionMatches = "ok"
void _check6

// 8) Selection slices expose the public SelectionInfo shape, never PM Selection.
type _SelectionAtomValue = AtomValue<ReturnType<typeof selectionAtom>>
type _SelectionLeaksPm = Extract<_SelectionAtomValue, ProseMirrorSelection> extends never
  ? "ok"
  : "pm-leak"
const _check7: _SelectionLeaksPm = "ok"
void _check7

type _SelectedNodeAtomValue = AtomValue<ReturnType<typeof selectedNodeAtom>>
type _SelectedNodeMatches = _SelectedNodeAtomValue extends SelectedNodeInfo | null
  ? "ok"
  : "fail"
const _check8: _SelectedNodeMatches = "ok"
void _check8
selectedNodeAtom(EditorId("locked-api"))

// 9) useDispatch returns an Effect, not a promise or raw editor escape hatch.
declare const _dispatch: ReturnType<typeof useDispatch>
type _DispatchResult = ReturnType<typeof _dispatch>
type _DispatchReturnsEffect = _DispatchResult extends Effect.Effect<unknown, unknown>
  ? "ok"
  : "fail"
const _check9: _DispatchReturnsEffect = "ok"
void _check9

// 10) NodeView props are typed by the caller; raw PM node is gated under unsafe.
const _nodeViewProps = useNodeViewProps<{ readonly userId: string }>()
const _userId: string = _nodeViewProps.attrs.userId
const _unsafeNode: unknown = _nodeViewProps.unsafe.node
void _userId
void _unsafeNode
