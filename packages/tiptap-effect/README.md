# tiptap-effect

An atom-driven Tiptap wrapper. Replaces `@tiptap/react` with a design built on
[Effect](https://effect.website/) and
[`@effect-atom/atom`](https://github.com/tim-smart/effect-atom).

## License

MIT. See [LICENSE.md](../../LICENSE.md).

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
| **Mutations** | Schema-bound built-ins plus app commands, all with typed input/output and typed undo. |
| **Undo/redo** | Effect-native history; PM's `History` plugin disabled. Branching, redo, `Reverse.notReversible`/`skipOnUndo` semantics. |
| **Macros** | `Sequence.atomic` (one PM transaction) + `Sequence.sequential` (auto-rollback on failure with typed `PartialFailure`). |
| **Schema** | `defineEditorSchema` generates a discriminated-union Effect Schema for the doc plus the Tiptap node/mark extensions, from one declaration. |
| **Selection** | Schema-typed `SelectionInfo` tagged union — no PM `Selection` types in the public API. |
| **NodeViews** | React components rendered via Portals; full access to `useDispatch`, `useEditorSlice`, `useHistory`, `useNodeViewProps`. |

## Quick Start

```tsx
import { Registry } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { Effect } from "effect"
import * as React from "react"
import {
  EditorId,
  EditorScope,
  Marks,
  Nodes,
  TiptapView,
  createEditor,
  defineEditorSchema,
  selectionAtom,
  useDispatch,
  useEditorSlice,
  useHistory,
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

const LessonEditor = createEditor(lessonSchema)

const initialContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
}

const editorId = EditorId("lesson-editor")

function Toolbar() {
  const dispatch = useDispatch()
  const history = useHistory()

  const toggleBold = Effect.gen(function* () {
    yield* dispatch(LessonEditor.commands.focus, undefined)
    yield* dispatch(LessonEditor.commands.toggleMark("bold"), undefined)
  })

  return (
    <div>
      <button
        type="button"
        onClick={() => void Effect.runPromise(toggleBold)}
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
      defaultContent: initialContent,
    }),
    [],
  )

  React.useEffect(() => () => registry.dispose(), [registry])

  return (
    <RegistryContext.Provider value={registry}>
      <EditorScope id={editorId} editor={LessonEditor} spec={spec}>
        <Toolbar />
        <TiptapView />
        <SelectionDebug />
      </EditorScope>
    </RegistryContext.Provider>
  )
}
```

## Schema-First Editors

The package starts from your document model, not from a React component. Define
nodes once, then build an editor kit whose commands, atoms, and document JSON all
share that schema.

```ts
import { Effect, Schema } from "effect"
import {
  type DocumentOf,
  Marks,
  Nodes,
  createEditor,
  defineEditorSchema,
  defineNodeDefinition,
  useDispatch,
} from "tiptap-effect"

const CalloutNode = defineNodeDefinition({
  name: "callout",
  attrsSchema: Schema.Struct({
    tone: Schema.Literal("info", "warning"),
    title: Schema.String,
  }),
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    { ...HTMLAttributes, "data-callout": "" },
    0,
  ],
})

const lessonSchema = defineEditorSchema({
  nodes: {
    doc: Nodes.DocNode,
    paragraph: Nodes.ParagraphNode,
    heading: Nodes.HeadingNode,
    callout: CalloutNode,
    text: Nodes.TextNode,
  },
  marks: {
    bold: Marks.BoldMark,
    italic: Marks.ItalicMark,
  },
})

type LessonDocument = DocumentOf<typeof lessonSchema>

const LessonEditor = createEditor(lessonSchema)
```

Now the built-ins know your schema:

```ts
const dispatch = useDispatch()

const content: LessonDocument = {
  type: "doc",
  content: [
    {
      type: "callout",
      attrs: { tone: "info", title: "Remember" },
      content: [{ type: "text", text: "Schema drives the editor." }],
    },
  ],
}

const program = Effect.gen(function* () {
  yield* dispatch(LessonEditor.commands.setContent, { content })
  yield* dispatch(LessonEditor.commands.updateNodeAttrsBySelector, {
    selector: { type: "callout", attrs: { tone: "info" } },
    attrs: { tone: "warning" },
  })
})

await Effect.runPromise(program)
```

And TypeScript catches schema drift at the command boundary:

```ts
dispatch(LessonEditor.commands.updateNodeAttrsBySelector, {
  selector: { type: "callout" },
  attrs: { level: 2 },
  //       ^^^^^ callout attrs are { tone, title }, not heading attrs
})

dispatch(LessonEditor.commands.findMatches, {
  selector: { textIncludes: "Remember", attrs: { tone: "info" } },
  //                                   ^^^^^ attrs require selector.type
})
```

With default Tiptap, these usually become `JSONContent` or `Record<string, any>`
mistakes. Here, the app-facing command API knows the document schema.

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
canExecuteAtom(id, LessonEditor.commands.toggleMark("bold"), undefined)
plainTextAtom(id)
LessonEditor.atoms.document(id)
LessonEditor.atoms.html(id)
```

`docAtom` decodes the current editor document against `schema.Document` and
returns `Result.success(doc)` or `Result.failure(parseError)`. The editor emits
an initial `"init"` snapshot when it boots, so `docAtom`, `htmlAtom`,
`plainTextAtom`, and selection slices expose the loaded document before the user
types.

Use `useEditorSlice((id) => LessonEditor.atoms.document(id), { debounceMs: 1500 })`
for persistence wiring so rapid typing produces one save-side emission per
window. Because the initial document is a real emission, autosave code should
treat `docAtom` as a read subscription, not a save policy by itself. Gate POSTs
with `dirtyAtom`, `LessonEditor.commands.markSaved(editorId)`, or an explicit
"skip first emission" guard when you only want to save user edits.

## Commands

Commands are the only supported mutation path. Built-ins live on the editor
returned by `createEditor`, so command inputs decode against the same document
schema as the editor.

Built-ins cover common toolbar actions and precise document patching:
`LessonEditor.commands.insertText`, `setContent`, `clearContent`,
`insertContentAt`, `replaceRange`, `deleteRange`, `deleteNodeAt`,
`replaceNodeAt`, `updateNodeAttrsAt`, `findMatches`, `replaceMatches`,
`deleteMatches`, `updateNodeAttrsBySelector`, `toggleMark`, `setHeading`,
`setParagraph`, `setLink`, `focus`, `blur`, and `markSaved`.

```ts
const LessonEditor = createEditor(lessonSchema, {
  commands: ({ editorCommand, document }) => ({
    insertCallout: editorCommand({
      op: "lesson.callout.insert",
      description: () => "Insert callout",
      inputSchema: Schema.Struct({
        title: Schema.String,
        tone: Schema.Literal("info", "warning"),
      }),
      outputSchema: document.outputs.previousContent,
      capturesSelection: true,
      reverseSetup: document.capturePreviousContent,
      apply: (chain, input) =>
        chain.insertContent({
          type: "callout",
          attrs: { title: input.title, tone: input.tone },
          content: [{ type: "text", text: input.title }],
        }),
      applyReverse: document.applyRestorePreviousContent,
    }),
  }),
})
```

Custom commands appear on the same object as the built-ins:

```ts
const program = Effect.gen(function* () {
  yield* dispatch(LessonEditor.commands.insertCallout, {
    title: "Check your assumptions",
    tone: "warning",
  })
  yield* dispatch(LessonEditor.commands.markSaved(editorId), undefined)
})

await Effect.runPromise(program)
```

For event handlers that do not need Effect composition, ask for promise mode at
the hook boundary:

```tsx
const dispatch = useDispatch({ mode: "promise" })

<button
  onClick={() =>
    void dispatch(LessonEditor.commands.insertCallout, {
      title: "Check your assumptions",
      tone: "warning",
    })
  }
>
  Insert
</button>
```

`Reverse.notReversible` blocks the first undo attempt and emits a typed event.
`Reverse.skipOnUndo` silently pops the record and continues to the next undoable
entry. `CommandErrorHandler` is part of `TiptapLayer`; unhandled failures are
logged and emitted through `useCommandErrors`.

## NodeViews

Attach a React component to a node definition with `reactNodeView(Component)`.
Inside the component, `useNodeViewProps<Attrs>()` exposes typed attrs, node
size, selection, and position helpers. The raw PM node is available only under
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

For common structural edits, prefer `useNodeViewActions()` over raw editor
access. It dispatches editor commands under the hood, so updates remain auditable and
undoable:

```tsx
const MediaBlock = reactNodeView(() => {
  const { attrs } = useNodeViewProps<{ title: string }>()
  const { updateAttrs, deleteNode, replaceNode } = useNodeViewActions()

  return (
    <button onClick={() => Effect.runPromise(updateAttrs({ title: attrs.title + "!" }))}>
      Rename
    </button>
  )
})
```
