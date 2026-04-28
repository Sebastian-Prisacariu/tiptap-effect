# tiptap-effect

An atom-driven Tiptap wrapper. Replaces `@tiptap/react` with a design built on
[Effect](https://effect.website/) and
[`@effect-atom/atom`](https://github.com/tim-smart/effect-atom).

## Why

`@tiptap/react` ships with a stack of workarounds for React/Tiptap impedance
mismatches: `forceUpdate()` calls, random-key remounts, scheduled-destruction
hacks for StrictMode, callback identity churn. The bugs aren't all consumer-
visible, but they're load-bearing.

`tiptap-effect` keeps the editor under atom ownership: lifetime governed by
Effect `Scope`, transactions funnelled through a single listener, slice atoms
derived from a transaction bus, mutations expressed as typed `Command`s with
typed undo. React reads from this layer; it never owns the editor.

## What you get

| Concern | tiptap-effect |
|---|---|
| **Editor lifecycle** | Atom-owned; `editor.destroy()` runs as a Scope finalizer, exactly once. |
| **StrictMode** | Survives via atom-registry idle TTL — no scheduled-destroy hacks. |
| **Re-renders** | Equality-checked slice atoms; subscribers only notify when their projection changes. |
| **Mutations** | Every action is a `Command` with `inputSchema`, `outputSchema`, typed `forward`/`reverse`. |
| **Undo/redo** | Effect-native history; PM's `History` plugin disabled. Branching, redo, `Reverse.notReversible`/`skipOnUndo` semantics. |
| **Macros** | `Sequence.atomic` (one PM transaction) + `Sequence.sequential` (auto-rollback on failure with typed `PartialFailure`). |
| **Schema** | `defineEditorSchema` generates a discriminated-union Effect Schema for the doc plus the Tiptap node/mark extensions, from one declaration. |
| **Selection** | Schema-typed `SelectionInfo` tagged union — no PM `Selection` types in the public API. |
| **NodeViews** | React components rendered via Portals; full access to `useDispatch`, `useEditorSlice`, `useHistory`, `useNodeViewProps`. |

## Install

Peer dependencies:

```bash
pnpm add effect @effect-atom/atom @effect-atom/atom-react @tiptap/core @tiptap/pm react react-dom
```

## Quick start

```tsx
import { Schema } from "effect"
import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import {
  defineEditorSchema,
  EditorScope,
  TiptapView,
  EditorId,
  useDispatch,
  useHistory,
  useEditorSlice,
  Commands,
  Slices,
  Nodes,
  Marks,
} from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: { doc: Nodes.DocNode, paragraph: Nodes.ParagraphNode, text: Nodes.TextNode, heading: Nodes.HeadingNode },
  marks: { bold: Marks.BoldMark, italic: Marks.ItalicMark },
})

const initialDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
}

const Toolbar = () => {
  const dispatch = useDispatch()
  const { undo, redo } = useHistory()
  return (
    <div>
      <button onClick={() => dispatch(Commands.ToggleMarkCommand("bold"), undefined)}>Bold</button>
      <button onClick={() => dispatch(Commands.ToggleMarkCommand("italic"), undefined)}>Italic</button>
      <button onClick={undo}>Undo</button>
      <button onClick={redo}>Redo</button>
    </div>
  )
}

const App = () => {
  const registry = React.useMemo(() => Registry.make(), [])
  return (
    <RegistryContext.Provider value={registry}>
      <EditorScope id={EditorId("lesson")} spec={{
        id: EditorId("lesson"),
        schema: lessonSchema,
        defaultContent: initialDoc,
      }}>
        <Toolbar />
        <TiptapView />
      </EditorScope>
    </RegistryContext.Provider>
  )
}
```

## Commands

Every mutation is a typed `Command`. Pure-editor commands use
`defineEditorCommand`; general (impure) commands use `defineCommand`.

```ts
import { defineEditorCommand } from "tiptap-effect"
import { Schema } from "effect"

export const InsertCalloutCommand = defineEditorCommand({
  op: "lesson.callout.insert",
  description: ({ text }) => `Insert callout "${text}"`,
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ pos: Schema.Number }),
  apply: (chain, { text }) =>
    chain.focus().insertContent({
      type: "callout",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    }),
  reverseSetup: (state, _input) => ({ pos: state.selection.from }),
  applyReverse: (chain, { text }, { pos }) =>
    chain.deleteRange({ from: pos, to: pos + text.length + 4 }),
})
```

### Reversibility

A `Command`'s `reverse` is one of:

- **A function** — reversible. Undo runs `reverse(input, output)`.
- **`Reverse.notReversible`** — hard-irreversible (sent emails, charged
  cards). Cmd-Z toasts and pauses; a second Cmd-Z within 3 s pops the entry
  and continues.
- **`Reverse.skipOnUndo`** — soft-irreversible (analytics, telemetry). Cmd-Z
  silently pops past it.

### Sequences

Compose multiple Commands into one:

```ts
import { Sequence } from "tiptap-effect"

const FormatAsCallout = Sequence.atomic(
  "macros.format-as-callout",
  [SetHeadingCommand, ToggleHighlightCommand, InsertContentCommand] as const,
  ([h, hl, ins]) => `Format as callout: H${h.level}, ${hl.color}, "${ins.text}"`,
)
```

`Sequence.atomic` fuses pure-editor steps' chains into ONE PM transaction.
`Sequence.sequential` runs any steps in order; on failure of step K, runs
reverses for 0..K-1 in reverse order and yields `PartialFailure`.

## NodeViews

Custom React components rendered as document nodes. Portals keep them inside
React's tree — full access to `useDispatch`, `useEditorSlice`, hooks.

```tsx
import { useNodeViewProps, useDispatch } from "tiptap-effect"

interface MentionAttrs extends Record<string, unknown> {
  userId: string
}

const MentionChip: React.FC = () => {
  const { attrs } = useNodeViewProps<MentionAttrs>()
  const dispatch = useDispatch()
  return (
    <span
      className="mention"
      onClick={() => dispatch(ResolveMentionCommand, { userId: attrs.userId })}
    >
      @{attrs.userId}
    </span>
  )
}

const MentionNode = {
  name: "mention",
  attrsSchema: Schema.Struct({ userId: Schema.String }),
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  reactNodeView: MentionChip,
}
```

v1 ships leaf NodeView support. Block nodes with `contentDOM`, React
Decorations, and explicit child-Scope wiring are tracked for v1.x / v2.

## Slice atoms

Read editor state reactively. Subscribers only re-render when the projected
value changes.

```ts
import { Slices, useEditorSlice } from "tiptap-effect"

const isBold = useEditorSlice(Slices.isActiveAtom("bold"))     // boolean
const selection = useEditorSlice(Slices.selectionAtom)         // SelectionInfo | null
const text = useEditorSlice(Slices.selectedTextAtom)           // string
```

Toolbar enabled-state from `undoableAtom` / `redoableAtom`:

```tsx
import { useAtomValue } from "@effect-atom/atom-react"
import { Result } from "@effect-atom/atom"
import { undoableAtom } from "tiptap-effect"

const canUndo = Result.getOrElse(useAtomValue(undoableAtom), () => false)
```

## Locked-down API

The package deliberately makes the right thing easy and the wrong thing hard:

- `useDispatch`, `useHistory`, `useEditorSlice` are the sanctioned mutation
  and read paths.
- `useRawEditor({ unsafe: true })` is the only escape hatch — the
  `unsafe: true` argument is a code-review marker.
- The PM `History` extension is filtered out at construction; the package's
  Effect-native `CommandHistory` is the single source of undo state.

Mutations made via `useRawEditor` BYPASS the Command system: they don't
appear in undo history, won't be auditable, won't be replayable. Use it only
when wrapping a one-off Tiptap-native operation that doesn't yet have a
Command wrapper.

## What's deferred to v1.x / v2

- A3 toggle UX (Cmd-Z double-tap) — wiring to React-level toast queue
- Coalescing window for `InsertTextCommand` (groups consecutive single-char
  inserts into one history entry)
- `dryRun(cmd)` for previewing Commands without committing
- `capturesSelection`-driven SelectionInfo recording in the executor
- Concurrency policy + pending atoms + transactional rollback (US-08)
- React-rendered Decorations
- Block-level NodeViews with `contentDOM`
- Real-time collaboration (Yjs / Hocuspocus) — see
  `.omc/plans/tiptap-effect-collab-v2.md`
- Long-term version snapshots — see
  `.omc/plans/tiptap-effect-version-history-v2.md`

## License

(Set in your distribution.)
