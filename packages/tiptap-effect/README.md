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

## Quick Start

```tsx
import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { Effect, Schema } from "effect"
import * as React from "react"
import {
  Commands,
  EditorId,
  EditorScope,
  type EditorSpec,
  Marks,
  Nodes,
  TiptapView,
  defineEditorSchema,
  defineEditorCommand,
  reactNodeView,
  selectionAtom,
  useDispatch,
  useEditorSlice,
  useHistory,
  useNodeViewProps,
} from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: {
    doc: Nodes.DocNode,
    paragraph: Nodes.ParagraphNode,
    heading: Nodes.HeadingNode,
    text: Nodes.TextNode,
  },
  marks: {
    bold: Marks.BoldMark,
    italic: Marks.ItalicMark,
  },
})

const initialContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
}

const editorId = EditorId("lesson-editor")

function Toolbar() {
  const dispatch = useDispatch()
  const history = useHistory()

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          Effect.runPromise(dispatch(Commands.ToggleMarkCommand("bold"), undefined))
        }
      >
        Bold
      </button>
      <button type="button" onClick={() => Effect.runPromise(history.undo())}>
        Undo
      </button>
    </div>
  )
}

function SelectionDebug() {
  const selection = useEditorSlice((id) => selectionAtom(id))
  return <pre>{JSON.stringify(selection, null, 2)}</pre>
}

export function App() {
  const registry = React.useMemo(() => Registry.make(), [])
  const spec = React.useMemo(
    () => ({
      id: editorId,
      schema: lessonSchema,
      defaultContent: initialContent,
    }) satisfies EditorSpec<Record<string, unknown>, Record<string, unknown>>,
    [],
  )

  React.useEffect(() => () => registry.dispose(), [registry])

  return (
    <RegistryContext.Provider value={registry}>
      <EditorScope id={editorId} spec={spec}>
        <Toolbar />
        <TiptapView />
        <SelectionDebug />
      </EditorScope>
    </RegistryContext.Provider>
  )
}
```

## Slice Atoms

Slice atoms are pure projections over the per-editor transaction bus. They are
lazy and equality-checked, so a component subscribed to `isActiveAtom(id,
"bold")` does not rerender for unrelated plain-text transactions.

```ts
selectionAtom(id)
selectedNodeAtom(id)
selectedTextAtom(id)
hasSelectionAtom(id)
isCollapsedAtom(id)
isActiveAtom(id, "bold")
canExecuteAtom(id, Commands.ToggleMarkCommand("bold"), undefined)
plainTextAtom(id)
docAtom(id, lessonSchema)
htmlAtom(id, lessonSchema)
```

`docAtom` decodes the latest editor document against `schema.Document` and
returns `Result.success(doc)` or `Result.failure(parseError)`. Use
`useEditorSlice((id) => docAtom(id, lessonSchema), { debounceMs: 1500 })` for
persistence wiring so rapid typing produces one save-side emission per window.

## Commands

Commands are the only supported mutation path. Each command owns an input
schema, output schema, forward effect, and reverse behavior. Editor commands
receive the current editor through the `CurrentEditor` service rather than
through React props.

Built-ins cover common toolbar actions and precise document patching:
`InsertTextCommand`, `InsertContentAtCommand`, `ReplaceRangeCommand`,
`DeleteRangeCommand`, `UpdateNodeAttrsCommand`, `SetContentCommand`,
`ClearContentCommand`, `ToggleMarkCommand`, `SetHeadingCommand`,
`SetLinkCommand`, `FocusCommand`, `BlurCommand`, and `MarkSavedCommand`.

```ts
const InsertCalloutCommand = defineEditorCommand({
  op: "lesson.callout.insert",
  description: () => "Insert callout",
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ from: Schema.Number, to: Schema.Number }),
  capturesSelection: true,
  apply: (chain, input) => chain.insertContent(`<p>${input.text}</p>`),
  reverseSetup: (state) => {
    const selection = state.selection as { from: number; to: number }
    return { from: selection.from, to: selection.to }
  },
  applyReverse: (chain, _input, output) =>
    chain.deleteRange({ from: output.from, to: output.to }),
})
```

`Reverse.notReversible` blocks the first undo attempt and emits a typed event.
`Reverse.skipOnUndo` silently pops the record and continues to the next undoable
entry. `CommandErrorHandler` is part of `TiptapLayer`; unhandled failures are
logged and emitted through `useCommandErrors`.

## NodeViews

Attach a React component to a node definition with `reactNodeView(Component)`.
Inside the component, `useNodeViewProps<Attrs>()` exposes typed attrs plus
selection and position helpers. The raw PM node is available only under
`unsafe.node`.

```tsx
const MentionChip = reactNodeView(() => {
  const { attrs, selected } = useNodeViewProps<{ userId: string }>()
  return <span data-selected={selected}>{attrs.userId}</span>
})
```

NodeViews are rendered as portals from `<TiptapView />`, so `RegistryContext`,
`EditorScope`, `useDispatch`, and `useEditorSlice` all work inside the NodeView
without passing editor instances through props.
