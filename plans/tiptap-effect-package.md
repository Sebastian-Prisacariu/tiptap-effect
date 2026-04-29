# `tiptap-effect`: Atom-driven Tiptap wrapper

> **Status**: Design draft v2 (revised after design discussion).
> **Goal**: A package that wraps the **vanilla** Tiptap `Editor` (not `@tiptap/react`) on top of `@effect-atom/atom`, with **Effect Schema as the source of truth for all data shapes**, exposes all mutations through a typed `Command` abstraction tied to a `ManagedRuntime`, and integrates with React without the lifecycle bugs that plague `@tiptap/react`.

> **Changes from v1**: Schema-first design (documents, nodes, marks, commands all schema-typed). Single `onTransaction` listener as the source for every reactive slice. `ScopedAtom` provider as the default React boundary; `<TiptapView />` is import-and-go. Public API hides the raw `editor` so the Command system is the only sanctioned mutation path. We ship our own Effect-native history plugin from day one and disable PM's history.

---

## TL;DR

`tiptap-effect` has four layers:

1. **Schema layer** — Effect Schema definitions for `TiptapDocument`, every `Node`, every `Mark`. Tiptap's runtime attribute specs are *derived* from these Schemas, so types and runtime parsers come from one source. All boundaries (initial content, paste, persistence, command IO) decode through Schema.
2. **Editor layer** — Atom-owned vanilla `Tiptap.Editor` whose lifetime is governed by the atom's Effect `Scope`. **One** listener (`onTransaction`) drives every reactive slice atom; per-event listeners do not exist.
3. **Command layer** — Every mutation is a typed `Command<Op, In, Out, Err, R>` with `inputSchema`, `outputSchema`, `errorSchema`, `description`, `forward`, `reverse`. Executed through a `CommandExecutor` running on a `ManagedRuntime` produced by `Atom.runtime(TiptapLayer)`. Our own Effect-native history. PM's `history` extension is disabled by default.
4. **React layer** — `<TiptapView />` is imported and used directly, scoped by an `<EditorScope>` provider. The public hooks (`useDispatch`, `useEditorSlice`) never expose the raw editor; an explicit `useRawEditor({ unsafe: true })` escape hatch exists for one-offs and carries a JSDoc warning. The contenteditable subtree is owned by ProseMirror; React never reconciles it.

The package targets Effect 4.x semantics (Layer / ManagedRuntime / Scope) and uses primitives from `@effect-atom/atom` (per-atom Scope, finalizers, `setIdleTTL`, `Atom.runtime`, `Atom.family`, `ScopedAtom`).

---

## Why a wrapper at all (problems we're solving)

The investigation of `.refs/tiptap/packages/react/` shows the React wrapper relies on a stack of workarounds that each patches a different React/Tiptap impedance mismatch. We want to bypass them by never letting React own the editor in the first place.

Concrete bugs/smells in `@tiptap/react`:

| Symptom | Where | Root cause |
|---|---|---|
| StrictMode double-mounts orphan editors | `useEditor.ts` `EditorInstanceManager.scheduleDestroy` (1ms timeout, lines 297–320) | React fires cleanup-then-effect-again synchronously; Tiptap has no idle-mounted concept. |
| Force re-renders on transaction | `EditorContent.tsx` `forceUpdate()` (line 127) | `setRenderer()` mutates external state; React isn't subscribed. |
| Random key remount of children | `EditorContentWithKey` (lines 182–195) | Editor identity changes don't propagate cleanly; key change defeats memoisation. |
| Callback identity churn | `useEditor.ts` ref-wrapper layer (lines 137–148) | Effect deps would otherwise rebuild on every render. |
| Schema rebuild on irrelevant prop changes | `compareOptions` shallow-compare (lines 182–221) | No structured dependency model; every "option" is opaque. |
| Untyped node attributes | `addAttributes()` returns plain JS object | No runtime validation; types and runtime drift silently. |
| Multiple listeners doing the same diff | `onUpdate` + `onSelectionUpdate` + `onTransaction` all wired separately | No single source of change; fanout is per-event. |

We replace the whole stack with: atom-owned editor, ref-only DOM mounting, single-funnel transaction reactivity, schema-validated boundaries, and a locked-down public API that funnels mutations through Commands.

---

## Architecture

### High-level diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Schema Layer  — TiptapDocument, NodeSchemas, MarkSchemas           │
│  (used at every IO boundary; nodes' Tiptap specs derived from these)│
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TiptapLayer (Effect Layer)                                         │
│  - CommandExecutor   (run / undo / redo / dryRun / history)         │
│  - CommandHistory    (ordered list of typed records, atom-backed)   │
│  - TransactionBus    (single subscription point for editor changes) │
└──────────────────┬──────────────────────────────────────────────────┘
                   │       editorRuntime = Atom.runtime(TiptapLayer)
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EditorAtom (Atom.family keyed by EditorId)                         │
│  - reads:  extensionsAtom, editableAtom, editorPropsAtom            │
│  - effect: lazy `new Editor({ element: null, ... })`                │
│            ONE `onTransaction` listener funnels all changes         │
│            into a per-editor TransactionBus.                        │
│  - finalizer: editor.destroy() exactly once                         │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Slice Atoms (Atom.map over the TransactionBus)                     │
│  - selectionAtom, isActiveAtom(name), docAtom, focusAtom, ...       │
│  - Each is a pure projection of the latest transaction snapshot.    │
│  - Equality-checked, so unrelated transactions don't notify them.   │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  React Layer                                                        │
│  - <EditorScope id="..."> provides per-scope EditorAtom via         │
│    ScopedAtom + RegistryProvider                                    │
│  - <TiptapView /> imports and uses the scoped atom directly         │
│  - useEditorSlice(slice), useDispatch(), useHistory()               │
│  - Raw `editor` NOT exposed; useRawEditor({unsafe:true}) is hatch   │
└─────────────────────────────────────────────────────────────────────┘
```

### 1. Schema layer

The package takes the **strict, generated** approach: consumers declare an `EditorSchema` (a record of nodes and marks, each with its own Schema), and the package generates a discriminated-union `Document` Schema from it. The editor's runtime PM schema is also generated from the same declaration, so types and runtime accept exactly the same set of nodes.

#### `defineEditorSchema`

```ts
// src/schema/define.ts
export const defineEditorSchema = <
  Nodes extends Record<string, NodeDefinition<any, any>>,
  Marks extends Record<string, MarkDefinition<any, any>>,
>(spec: { nodes: Nodes; marks: Marks; migrate?: (raw: unknown) => unknown }) => {
  // Each node's attrsSchema + Schema.Literal(name) for type → discriminated-union Node Schema
  const NodeUnion = Schema.Union(...Object.entries(spec.nodes).map(([name, def]) =>
    Schema.Struct({
      type: Schema.Literal(name),
      attrs: def.attrsSchema,
      content: Schema.optional(Schema.Array(Schema.suspend(() => NodeUnion))),
      text: Schema.optional(Schema.String),
      marks: Schema.optional(Schema.Array(MarkUnion)),
    })
  ))
  const MarkUnion = /* same shape for marks */
  const Document = Schema.Struct({ type: Schema.Literal("doc"), content: Schema.Array(NodeUnion) })

  // Generated Tiptap node/mark extensions (using addAttributes derived from each Schema)
  const tiptapExtensions = [
    ...Object.entries(spec.nodes).map(([name, def]) => buildTiptapNode(name, def)),
    ...Object.entries(spec.marks).map(([name, def]) => buildTiptapMark(name, def)),
  ]

  return { Document, NodeUnion, MarkUnion, tiptapExtensions, migrate: spec.migrate }
}
```

Consumer call site:

```ts
const lessonSchema = defineEditorSchema({
  nodes: {
    doc:       DocNode,
    paragraph: ParagraphNode,
    heading:   HeadingNode,
    callout:   CalloutNode,
    mention:   MentionNode,
  },
  marks: {
    bold: BoldMark, italic: ItalicMark, link: LinkMark,
  },
  migrate: (raw) => /* optional: rename old fields, add defaults, drop deprecated nodes */ raw,
})

type LessonDoc = lessonSchema.Document.Type
//                                         ^? { type: "doc", content: ReadonlyArray<DocNode | Paragraph | Heading | Callout | Mention> }
```

#### Wired to the editor

`schema` and `extensions` are kept as **two concepts** in the `EditorSpec`:

```ts
makeEditorAtom({
  schema: lessonSchema,                                  // nodes & marks (generates node/mark Tiptap extensions)
  extensions: [Placeholder, Dropcursor, EffectHistory],  // behaviour-only extensions
  defaultContent: /* validated against lessonSchema.Document */,
})
```

The editor's actual extension list = `schema.tiptapExtensions ∪ extensions`. We assert at construction that no `extensions` entry duplicates a node/mark already declared in `schema` (and that the consumer hasn't accidentally re-included `History`, which we replace with our `EffectHistory`).

#### Validation at boundaries

- `defaultContent` runs through `schema.migrate` (if provided) then `Schema.decodeUnknown(schema.Document)`. Failure → `EditorInitError`.
- `setContent` (via the `SetContentCommand`) runs the same pipeline.
- Persistence reads/writes go through `Schema.encode` / `Schema.decode` of `schema.Document`.
- **Dev-only sanity check** (`devSchemaCheck: true` on the `EditorSpec`): after each transaction, the bus runs `Schema.is(schema.Document)` on `editor.getJSON()` and logs a warning if it fails. Off in production by default.

#### One schema per editor

Schemas live with the `EditorSpec`. Multi-feature apps declare multiple schemas (a `lessonSchema`, a `commentSchema`); each `EditorScope` carries its own. Multi-tenant apps with per-tenant node sets just key the editor by tenant id and declare schemas accordingly.

#### Per-node Schema → Tiptap `addAttributes` derivation

Every custom node ships an Effect Schema for its `attrs`. A helper derives the Tiptap attribute spec from the Schema, so types and runtime parsers come from one source:

```ts
// src/schema/derive.ts
import { Schema, AST } from "effect"

export const tiptapAttrsFromSchema = <S extends Schema.Struct.Fields>(
  schema: Schema.Struct<S>
): TiptapAddAttributes => {
  // Walk schema fields, derive { default, parseHTML, renderHTML } per field.
  // Default is taken from Schema.optionalWith(..., { default: ... }) or undefined.
  // parseHTML / renderHTML pull from data-* attribute by field name.
}
```

Example node:

```ts
// src/nodes/heading.ts
const HeadingAttrs = Schema.Struct({
  level: Schema.Literal(1, 2, 3, 4, 5, 6).pipe(Schema.optionalWith({ default: () => 1 })),
})

export const HeadingNode = defineNode({
  name: "heading",
  attrsSchema: HeadingAttrs,
  // ...rest is plain Tiptap Node config; we synthesise addAttributes from attrsSchema
})
```

Result: changing the Schema fixes the type *and* the parsing/serialisation — no drift.

#### Validation at boundaries

Every IO boundary decodes:

- `setContent(json)` → `Schema.decodeUnknown(TiptapDocument)(json)` first.
- `getJSON()` returns `Schema.encode(TiptapDocument)`-validated output (or asserts in tests).
- Persistence writes go through `Schema.encode`; reads through `Schema.decode`.
- `defaultContent` provided to `makeEditorAtom` is decoded at editor construction; invalid → `EditorInitError`.

### 2. Editor layer

#### `EditorRuntime` — `Atom.runtime` over the Layer

```ts
// src/runtime.ts
import { Atom } from "@effect-atom/atom"
import { Layer } from "effect"

export const TiptapLayer = Layer.mergeAll(
  CommandExecutor.Default,
  CommandHistory.Default,
  TransactionBus.Default,
)

export const editorRuntime = Atom.runtime(TiptapLayer)
```

#### `Atom.family` of editors

Each editor is identified by an `EditorId` (a brand). `editorAtomFamily(id)` returns a `Writable<EditorState, EditorAction>`:

```ts
// src/editor.ts
export const editorAtomFamily = Atom.family((spec: EditorSpec) =>
  Atom.make((get) => {
    const extensions = get(spec.extensionsAtom)
    const editable   = get(spec.editableAtom)
    const editorProps = get(spec.editorPropsAtom)

    // Validate initial content at the boundary
    const initialContent = Schema.decodeUnknownSync(TiptapDocument)(spec.defaultContent)

    const editor = new TiptapEditor({
      element: null,                       // we'll mount manually
      extensions: withoutPmHistory(extensions),  // we ship our own
      editable,
      editorProps,
      content: initialContent,
    })

    // Single transaction funnel — see §3
    const dispose = wireTransactionFunnel(editor, spec.id, get)

    get.addFinalizer(() =>
      Effect.sync(() => {
        dispose()
        if (!editor.isDestroyed) editor.destroy()
      })
    )

    return {
      mount: (el: HTMLElement | null) => {
        if (el) editor.mount(el)
        else editor.unmount()
      },
      // editor itself is NOT in the public return — see §6 (locked-down API)
      _internal: { editor },
    }
  }).pipe(Atom.setIdleTTL("2 seconds"))
)
```

Note `withoutPmHistory(extensions)` — we filter out `@tiptap/extension-history` and `Extension.create({ name: 'history', ... })`-shaped clones. We replace it with our own (see §4).

#### Surgical option diffing

Most spec changes do **not** need a rebuild. We split the spec into atoms by reaction:

| Atom | Reaction on change | Rebuild? |
|---|---|---|
| `extensionsAtom` | New `TiptapEditor(...)` | **Yes** (schema can only be set at construction) |
| `editableAtom` | `editor.setEditable(x, false)` | No |
| `editorPropsAtom` | `editor.setOptions({ editorProps })` | No |
| `defaultContentAtom` | (one-shot at construction; later changes via `SetContentCommand`) | No |

Implementation: `editorAtomFamily` is one orchestrator atom that reads each dimension; we use a **dependency-keyed family** for the `extensionsAtom` value (so identical extensions reuse the same instance across StrictMode) and apply patches inline for the other dimensions.

### 3. The single-listener transaction funnel

This is the heart of the design. We attach **one** listener:

```ts
// src/editor.ts (snippet)
const wireTransactionFunnel = (editor: TiptapEditor, id: EditorId, get: Context) => {
  const bus = get(transactionBusAtomFamily(id))
  const handler = ({ transaction, editor }: TransactionEvent) => {
    bus.push({
      tr: transaction,
      docChanged: transaction.docChanged,
      selectionSet: transaction.selectionSet,
      stateAfter: editor.state,
      // any tagged metadata we want to expose
    })
  }
  editor.on("transaction", handler)
  return () => editor.off("transaction", handler)
}
```

`TransactionBus` is a `SubscriptionRef`-backed atom (see effect-atom `Atom.subscriptionRef`) holding the latest snapshot. Every slice atom is a derived projection:

```ts
export const selectionAtom = (id: EditorId) =>
  transactionBusAtomFamily(id).pipe(
    Atom.map(snapshot => ({
      from: snapshot.stateAfter.selection.from,
      to:   snapshot.stateAfter.selection.to,
    })),
    // Equality checked so identical selections (caret didn't move) don't notify
  )

export const isActiveAtom = (id: EditorId, markName: string, attrs?: object) =>
  transactionBusAtomFamily(id).pipe(
    Atom.map(snapshot => isActiveOnState(snapshot.stateAfter, markName, attrs)),
  )
```

Why this is strictly better than per-event listeners:

- One subscription means deterministic ordering and no listener leakage.
- Slice atoms are pure projections — easy to test with synthetic transaction snapshots.
- The transaction object itself is available to slice atoms that need fine-grained info (e.g., "did this transaction change the selection while keeping the doc constant?").
- React rerenders are bounded by atom equality — a slice doesn't notify if its projection didn't change, so typing 10 characters re-runs `selectionAtom`'s map 10 times but only notifies its subscribers when the selection actually moves.

### 4. Reversibility model and Effect-native history (replaces PM history)

#### Tri-state reversibility

Commands declare reversibility via the `reverse` field:

```ts
// Reversible (default if `reverse` is a function)
defineCommand({
  reverse: (input, output) => Effect.gen(/* ... */),
})

// Hard-irreversible — blocks chain undo
defineCommand({
  reverse: Reverse.notReversible,    // sentinel
})

// Soft-irreversible — chain can undo past it
defineCommand({
  reverse: Reverse.skipOnUndo,       // sentinel
})
```

| Kind | Use case | Behaviour on Cmd-Z |
|---|---|---|
| Reversible | Editor mutations, recoverable API calls | Normal: pop history, run reverse |
| `notReversible` | Sent emails, charged cards, published-and-announced events | A3 toggle: first Cmd-Z toasts, second Cmd-Z within 3 s pops & continues |
| `skipOnUndo` | Analytics pings, telemetry, audit logs | Silently skip; continue to next entry |

Default if `reverse` is omitted from a `defineCommand`: `notReversible` (safe-fail; authors must opt in to undo behaviour).

#### `Sequence.sequential` reversibility composition

A Sequence's reversibility is derived from its steps:

- Any step with `notReversible` → the whole Sequence is `notReversible` (A3 toggle).
- Steps with only `skipOnUndo` and reversible kinds → the Sequence is reversible; undoing runs each step's reverse in reverse order, with `skipOnUndo` steps yielding `Effect.void`.

This solves the analytics case: a Sequence `[PublishCourseCommand, EmitTelemetryCommand]` where telemetry is `skipOnUndo` is fully undoable — the telemetry record stays in audit but doesn't block undo.

`Sequence.atomic` requires all-reversible (or `skipOnUndo`) steps; type-level enforcement.

```ts
// src/history.ts
class CommandHistory extends Effect.Service<CommandHistory>()(
  "tiptap-effect/CommandHistory",
  {
    effect: Effect.gen(function* () {
      const past   = yield* SubscriptionRef.make<CommandRecord[]>([])
      const future = yield* SubscriptionRef.make<CommandRecord[]>([])
      // ... push, pop, peek, clear, undo, redo, list
    }),
  }
) {}
```

Properties:

- All entries are typed `CommandRecord<In, Out>` — fully serialisable via `Schema.encode`.
- `undo()` consults the top entry's reversibility:
  - **Reversible**: pop, run reverse, push to `future`.
  - **`skipOnUndo`**: pop, push to `future`, recurse to undo the next entry (no toast, no visible pause).
  - **`notReversible`** (A3 toggle): first call within 3 s toasts "Can't undo this action — press again to skip past it" and is otherwise a no-op. Second call within the window pops and recurses (the irreversible record stays in audit but is removed from the live stack; not redoable).
- `redo()` re-runs `Command.forward(input)` for the top of `future`, moves it back to `past`. Irreversible records cannot be redone (they were never in `future`).
- A `redoableAtom` and `undoableAtom` expose whether the buttons should be enabled.
- Coalescing: `InsertTextCommand` records with the same caret position and within `coalesceWindow` (default 500 ms) merge into one entry. The window is broken by an undo (typing after Cmd-Z starts fresh).
- Branching policy: any new command after an undo clears `future` (linear undo).
- Bounded: configurable max length (default 1000); oldest entries are dropped.

Cmd-Z while a Command is in-flight: the in-flight fiber is interrupted (`transactional` rollback runs if applicable), then `undo()` proceeds to the entry below.

`pmHistoryDisabled` is the default. There's an `enablePmHistoryInsteadOfCommands` escape hatch in `EditorSpec` for users who explicitly want PM-only undo (no commands), but it's deliberately awkward to discover.

#### Long-term version history → v2

`CommandHistory` is for live undo (linear, recent). Document **version snapshots** with tiered retention is a separate v2 feature — see `.omc/plans/tiptap-effect-version-history-v2.md`.

### 5. Command type and executor

```ts
// src/command.ts
import { Schema, Effect } from "effect"

export interface Command<
  Op extends string,
  In,
  Out,
  Err = never,
  R = never,
> {
  readonly op: Op
  readonly description: (input: In) => string
  readonly inputSchema: Schema.Schema<In>
  readonly outputSchema: Schema.Schema<Out>
  readonly errorSchema: Schema.Schema<Err>
  readonly forward: (input: In) => Effect.Effect<Out, Err, R>
  readonly reverse: (input: In, output: Out) => Effect.Effect<void, Err | NotReversibleError, R>
  readonly coalesceKey?: (input: In) => string  // for adjacent merges (e.g. InsertText)
}

export const defineCommand = <Op extends string, In, Out, Err, R>(
  cmd: Command<Op, In, Out, Err, R>
) => cmd
```

`CommandExecutor`:

```ts
class CommandExecutor extends Effect.Service<CommandExecutor>()(
  "tiptap-effect/CommandExecutor",
  {
    effect: Effect.gen(function* () {
      const history = yield* CommandHistory
      return {
        run:   <Op,In,Out,Err,R>(cmd: Command<Op,In,Out,Err,R>, input: In) =>
                 Effect.gen(function* () {
                   const validated = yield* Schema.decodeUnknown(cmd.inputSchema)(input)
                   const out = yield* cmd.forward(validated)
                   yield* history.push({ cmd, input: validated, output: out })
                   return out
                 }),
        undo:  () => history.undo(),
        redo:  () => history.redo(),
        dryRun: <In,Out,Err,R>(cmd: Command<any,In,Out,Err,R>, input: In) =>
                 // Run forward in a transaction we always roll back
                 Effect.acquireUseRelease(/* ... */),
        history: () => history.list(),
      }
    }),
  }
) {}
```

#### Built-in commands

We wrap each common Tiptap command into a `Command`. A small `wrapToggleMark` helper covers most of the toolbar:

```ts
// src/commands/toggle-mark.ts
export const ToggleMarkCommand = (markName: string) =>
  defineCommand({
    op: `tiptap.mark.${markName}.toggle` as const,
    description: () => `Toggle ${markName}`,
    inputSchema: Schema.Void,
    outputSchema: Schema.Struct({ wasActive: Schema.Boolean }),
    errorSchema: Schema.Never,
    forward: () => Effect.gen(function* () {
      const editor = yield* CurrentEditor
      const wasActive = editor.isActive(markName)
      editor.chain().focus().toggleMark(markName).run()
      return { wasActive }
    }),
    reverse: (_, { wasActive }) => Effect.gen(function* () {
      const editor = yield* CurrentEditor
      const isActive = editor.isActive(markName)
      if (isActive !== wasActive) editor.chain().focus().toggleMark(markName).run()
    }),
  })
```

`CurrentEditor` is a `Context.Tag` provided by the runtime per active editor — that's how commands get the editor handle without us exposing it to React.

### 6. React layer

#### `<EditorScope>` — the default boundary

```tsx
// src/react/EditorScope.tsx
export const EditorScope: FC<{ id: EditorId; spec: EditorSpec; children: ReactNode }> =
  ({ id, spec, children }) => {
    // Wraps a ScopedAtom Provider that exposes a per-scope editor atom.
    // Inside this subtree, useDispatch/useEditorSlice/<TiptapView /> all
    // resolve to the same per-scope atom without prop drilling.
    return (
      <ScopedEditorContext.Provider value={{ id, spec }}>
        {children}
      </ScopedEditorContext.Provider>
    )
  }
```

Single-editor case:
```tsx
<EditorScope id="main" spec={spec}>
  <TiptapView />
  <Toolbar />
</EditorScope>
```

Multi-editor case:
```tsx
<EditorScope id="title" spec={titleSpec}>
  <TiptapView />
</EditorScope>
<EditorScope id="body" spec={bodySpec}>
  <TiptapView />
</EditorScope>
```

`<TiptapView />` doesn't take an atom prop in the default API — it reads from the surrounding scope. There **is** an escape hatch (`<TiptapView atom={...} />`) but it's tagged `@advanced` in JSDoc and not in the default examples.

#### `<TiptapView />`

```tsx
export const TiptapView: FC = () => {
  const { id } = useScopedEditor()
  const { mount } = useAtomValue(editorAtomFamily(id))
  return <div ref={mount} />
}
```

The `mount` callback is stable (atom value identity) — passing it as the ref callback is safe; React calls it with the element on mount and `null` on unmount.

#### Public hooks

```ts
// src/react/hooks.ts

// Read a slice — never returns the raw editor
export function useEditorSlice<T>(slice: (id: EditorId) => Atom<T>): T

// Dispatch a Command (stable callback, returns Effect)
export function useDispatch(): <In, Out, Err>(
  cmd: Command<any, In, Out, Err, any>,
  input: In,
) => Effect.Effect<Out, Err>

// Promise version for ergonomic component code
export function useDispatchPromise(): <In, Out, Err>(
  cmd: Command<any, In, Out, Err, any>,
  input: In,
) => Promise<Out>

// History
export function useHistory(): {
  undo: () => Effect.Effect<void>
  redo: () => Effect.Effect<void>
  past: ReadonlyArray<CommandRecord>
  future: ReadonlyArray<CommandRecord>
}

// Subscribe imperatively (e.g., status bar)
export function useEditorSubscribe<T>(
  slice: (id: EditorId) => Atom<T>,
  f: (value: T) => void,
): void

// Escape hatch — DO NOT USE in product code
/**
 * @advanced
 * @deprecated-style
 * Returns the raw Tiptap Editor instance.
 *
 * Mutations made through this handle BYPASS the Command system:
 * they will NOT appear in undo history, will NOT be auditable, and
 * will NOT be replayable. Reach for `useDispatch` and a `Command`
 * first; only use this hook when wrapping a one-off Tiptap-native
 * operation that doesn't yet have a Command wrapper.
 */
export function useRawEditor(opts: { unsafe: true }): TiptapEditor
```

Why the `{ unsafe: true }` shape: code review can grep for `useRawEditor` and see exactly where the escape hatch is used; the `unsafe` argument makes it impossible to accidentally call.

### 7. NodeViews and in-editor React UI

NodeViews (custom React components rendered as document nodes — Mention chips, embeds, callouts) and Decorations (React widgets attached without replacing nodes) are supported, with **lifetime governed by child Scopes of the editor's atom Scope**. Effect's "child scopes close before parent" semantics give us "all NodeViews unmount before `editor.destroy()`" without any consumer effort.

#### Lifecycle mechanism

```
editor atom Scope (parent)
├── editor.destroy() finalizer        ← runs LAST
├── NodeView A child Scope
│   └── root.unmount() finalizer
├── NodeView B child Scope
│   └── root.unmount() finalizer
└── …
```

- When PM creates a NodeView, we `Scope.fork` the editor's Scope and register `root.unmount()` as the child finalizer.
- When PM destroys a NodeView (node removed from doc), we close just that child Scope.
- When the editor is disposed, its Scope closes top-down: every NodeView's `root.unmount()` runs first, then `editor.destroy()`.
- Cleanup-order guarantee: a NodeView's `useEffect` cleanup that calls editor APIs is safe — the editor still exists when the cleanup fires.

```ts
// src/react/node-view.tsx (sketch)
export const reactNodeView = <P,>(Component: FC) =>
  (editorScope: Scope.Scope, ctx: { registry, scopedEditor }) =>
    ({ node, getPos, view, decorations }: NodeViewParams) => {
      const dom = document.createElement("div")
      const contentDOM = node.isLeaf ? null : document.createElement("div")
      if (contentDOM) dom.appendChild(contentDOM)

      const childScope = Effect.runSync(Scope.fork(editorScope, ExecutionStrategy.sequential))
      const root = createRoot(dom)
      Effect.runSync(Scope.addFinalizer(childScope, Effect.sync(() => root.unmount())))

      root.render(
        <RegistryProvider registry={ctx.registry}>
          <ScopedEditorContext.Provider value={ctx.scopedEditor}>
            <NodeViewContext.Provider value={{ getPos, view, decorations }}>
              <Suspense fallback={null}><Component /></Suspense>
            </NodeViewContext.Provider>
          </ScopedEditorContext.Provider>
        </RegistryProvider>
      )

      return {
        dom,
        contentDOM,
        update: () => true,                                  // no-op: bus drives re-renders
        destroy: () => Effect.runSync(Scope.close(childScope, Exit.void)),
      }
    }
```

Render is **async** (no `flushSync`) — the microtask delay is invisible in practice and async lets React batch when many NodeViews are created in one transaction.

#### Re-render policy: derived atoms over the bus

NodeView props are a derived atom over the transaction bus:

```ts
export const nodeViewPropsAtomFamily = Atom.family(
  ({ editorId, getPos }: { editorId: EditorId; getPos: () => number | undefined }) =>
    transactionBusAtomFamily(editorId).pipe(
      Atom.map((snapshot) => {
        const pos = getPos()
        if (pos === undefined) return null
        const node = snapshot.stateAfter.doc.nodeAt(pos)
        if (!node) return null
        return {
          attrs: node.attrs as NodeAttrs.Type,
          selected: isNodeSelected(snapshot.stateAfter.selection, pos, node.nodeSize),
          pos,
        }
      }),
    )
)
```

PM's `update(newNode)` callback is a no-op (`return true`); the bus is a strict superset of update events, so we never need both. Equality on the projected props means an unrelated transaction (e.g., typing in another paragraph) doesn't re-render this NodeView.

#### Public hooks inside NodeViews

NodeView components get their own hook surface, mirroring the locked-down outside API:

```ts
// Schema-typed node props; raw PM Node available as escape hatch
export function useNodeViewProps<A>(): {
  attrs: A                          // typed by the node's attrsSchema
  selected: boolean
  getPos: () => number | undefined
  unsafe: { node: PMNode }
}

// Same dispatch/slice/history as outside the editor
useDispatch()
useEditorSlice(slice)
useHistory()
```

**Mutation rules inside NodeViews are the same as outside**: dispatch a Command. The "Resolve" button on a Mention chip dispatches `ResolveMentionCommand({ pos: getPos() })`; the Command's `forward` resolves the position again at run time, so a stale `getPos` is handled by typed `NodeNotFoundError`.

**Data fetching inside NodeViews**: use `Atom.family` of `editorRuntime.atom(...)`. Sharing across NodeViews with the same key is automatic; lifetime is handled by registry refcount + `setIdleTTL`. Avoid `useEffect`-driven fetches.

#### Decorations

DOM-widget Decorations also support React via the same mechanism. The decoration's container is a placeholder element; we open a child Scope and mount a React root inside it, identical to NodeView lifecycle. Use cases: ghost-text completions, comment markers, AI-suggestion overlays.

For non-React decorations (small, vanilla DOM), consumers can use PM's decoration API directly without touching our wrapper.

#### Rules summary (carried into review)

- No `useRawEditor` inside NodeViews. Same lock-down as outside.
- Mutations → `useDispatch(Command)`.
- Data fetches → `Atom.family` of `editorRuntime.atom(Effect.gen(...))`.
- `getPos()` resolved at command-run time (inside `forward`), never captured at dispatch time.
- One-shot side effects with cancellation: revisit if/when a concrete need appears (a `useNodeViewScoped` hook is straightforward to add later, but not shipped in v1).

### 8. Command composition

Two distinct composition needs are kept distinct:

#### (a) Atomic multi-step inside one Command

Most "compound" actions belong here. A `Command.forward` is just an Effect; inside it the author uses `editor.chain().…run()` (via `CurrentEditor`) to make multiple PM operations land as one transaction. One PM transaction, one history record. **No new primitive** — write it as one Command.

```ts
export const InsertCalloutCommand = defineEditorCommand({
  op: "tiptap.callout.insert",
  inputSchema: Schema.Struct({ at: Schema.Number, text: Schema.String }),
  outputSchema: Schema.Struct({ pos: Schema.Number }),
  apply: (chain, { at, text }) =>
    chain.insertContentAt(at, { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
         .setTextSelection(at + 1),
  reverseSetup: (stateBefore, { at }) => ({ pos: at }),
  applyReverse: (chain, _, { pos }) => chain.deleteRange({ from: pos, to: /* node end */ }),
})
```

`defineEditorCommand` is a sugar over `defineCommand` for **pure editor** Commands — those whose forward and reverse can be expressed as chain operations. It captures the chain ops as data, which makes the Command **fusable** into a single PM transaction by `Sequence.atomic` (below). General Commands still use `defineCommand` directly.

#### (b) Sequencing existing Commands

For higher-level macros that combine independent Commands, we provide two combinators:

**`Sequence.atomic`** — accepts only `defineEditorCommand`-shaped Commands. Fuses all step chains into one PM transaction. Either every step lands or none does (PM rejects the transaction). One history entry; one undo. Editor never reflects partial state.

**`Sequence.sequential`** — accepts any Commands. Runs forwards in order. On failure of step K, runs reverses for steps 0..K-1 in **reverse order**, then yields `PartialFailure { failedAt, rolledBackThrough, irreversible? }`. Editor briefly reflects partial state before rollback. One history entry on full success; nothing recorded on failure.

```ts
// All editor-pure → atomic
export const FormatAsCalloutSequence = Sequence.atomic(
  "tiptap.macro.format-as-callout",
  [SetHeadingCommand, ToggleHighlightCommand, InsertContentCommand] as const,
  ([h, hl, ins]) => `Format as callout: H${h.level}, ${hl.color}, "${ins.text}"`,
)

// Includes an async API call → sequential with rollback
export const PublishAndAnnounceSequence = Sequence.sequential(
  "tiptap.macro.publish-announce",
  [PublishCommand, SendAnnouncementCommand] as const,
  ([pub, ann]) => `Publish "${pub.title}" and announce to ${ann.audience}`,
)
```

#### Sequence properties

- A Sequence **is** a Command (same interface, same executor, same history). Nesting Sequences works for free.
- Inputs are `readonly [Step0Input, Step1Input, ...]` — typed positionally per step.
- Outputs are `readonly [Step0Output, Step1Output, ...]`.
- Errors are `Step0Err | Step1Err | ... | PartialFailure`.
- `Schema.encode` of a Sequence record produces `{ op, steps: [{op, input}, …] }` — replayable end-to-end (any agent or test fixture can dispatch a recorded sequence).
- Dispatched from a NodeView: identical to dispatching any Command. No special-casing.
- Cmd-Z reverts the whole Sequence. The Sequence's reverse runs each step's reverse in reverse order. For atomic Sequences, this is one PM transaction (deterministic). For sequential Sequences, it's N transactions, but with `NotReversibleError` typing if any step opted out.

#### Rule for Command authors

> If your Command's `forward` only does PM operations, write it as `defineEditorCommand` (with `apply` / `applyReverse`). This makes it fusable.
>
> If your Command does anything else (API call, scheduling, telemetry, anything outside PM), write it as `defineCommand` (general Effect). This keeps it correct but excludes it from `Sequence.atomic`.

### 9. Selection model

The selection is exposed as a Schema-typed tagged union; no PM `Selection` type leaks into the public API.

```ts
// src/schema/selection.ts
export const SelectionInfo = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("text"), from: Schema.Number, to: Schema.Number, head: Schema.Number, empty: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("node"), pos: Schema.Number, nodeType: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("all"),  from: Schema.Number, to: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("gap"),  pos: Schema.Number }),
)
export type SelectionInfo = typeof SelectionInfo.Type
```

#### Slice atoms

- `selectionAtom`: `Atom<SelectionInfo>` — full tagged union.
- `selectedTextAtom`: `Atom<string>` — derived; the literal text in the current selection (empty string for caret/non-text).
- `selectedNodeAtom`: `Atom<{ pos, nodeType, attrs } | null>` — derived; non-null only on `NodeSelection`.
- `hasSelectionAtom`: `Atom<boolean>` — `selection.kind !== "text" || !selection.empty`.
- `isCollapsedAtom`: `Atom<boolean>` — caret only, no range.

All slice atoms are equality-checked, so identical selections don't notify subscribers.

#### Selection in Commands

`defineEditorCommand` gains an optional `capturesSelection` flag:

```ts
defineEditorCommand({
  op: "tiptap.mark.bold.toggle",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({ wasActive: Schema.Boolean }),
  capturesSelection: true,                                        // ← NEW
  apply: (chain, _) => chain.toggleBold(),                        // selection pre-applied by executor
  reverseSetup: (state) => ({ wasActive: isMarkActive(state, "bold") }),
  applyReverse: (chain, _, { wasActive }) =>
    wasActive ? chain : chain.toggleBold(),
})
```

Behaviour:

- At dispatch time, if `capturesSelection: true`, the executor reads `editor.state.selection`, encodes as `SelectionInfo`, and attaches it to the `CommandRecord` (typed; serialisable).
- Before running the Command's `apply` chain, the executor pre-applies the captured selection: `editor.chain().setSelection(captured)...`. This guarantees the chain runs against the captured selection, even if the user has moved the caret since dispatch (extremely unlikely, but deterministic).
- On `undo`, the reverse runs against the captured selection (executor pre-applies it before `applyReverse`). Selection is restored as a side effect: the user sees the cursor back where it was when the action happened.
- Default is `false` — Commands that don't depend on selection (`SetContentCommand`, `FocusCommand`) record nothing.
- Commands that take an explicit range as input (e.g., a "format range" Command) keep `capturesSelection: false` and put the range in `inputSchema`. Explicit data wins.

#### Replay across doc edits — out of scope for v1

A captured `{ from: 12, to: 18 }` from yesterday won't necessarily map to the same logical content today. Replay-with-PM-mapping is a future enhancement (`replayWithMapping: true`); v1 documents this as a known limitation.

### 9b. Persistence and content IO

The package owns reactive content surfaces; the consumer owns the actual save/load round-trip.

#### Initial load

`defaultContent` is passed synchronously by the consumer. Async loads happen in user-land (consumer renders a spinner until the data is in hand, then mounts `<EditorScope>` with the loaded content).

```tsx
const { data: lesson } = useQuery(...)
if (!lesson) return <Spinner />
return (
  <EditorScope id="lesson" spec={{ schema: lessonSchema, defaultContent: lesson.content }}>
    <TiptapView />
  </EditorScope>
)
```

#### Reactive read surfaces

Slice atoms expose the doc and renderings:

```ts
slices.docAtom        // Atom<Result<LessonDoc, ParseError>> — Schema.encode(editor.getJSON())
slices.htmlAtom       // Atom<string>                       — editor.getHTML()
slices.plainTextAtom  // Atom<string>                       — editor.getText()
slices.dirtyAtom      // Atom<boolean>                      — current doc !== last-saved snapshot
```

`docAtom` returns `Result<LessonDoc, ParseError>` so encode failures surface explicitly. In practice failure should be impossible (PM schema is generated from the Effect Schema), but if it ever happens we don't silently lose data — the consumer's persistence wiring sees the `Failure` and can log/alert.

All slice atoms are equality-checked. `Atom.map` is lazy — `docAtom` only recomputes when actually read by a subscriber. Wiring it to a `<pre>` for debug rendering is a documented trap (re-encodes the whole doc per keystroke); we ship a `useEditorSlice(slices.docAtom, { debounceMs })` overload to mitigate.

#### Dirty tracking and `markSaved`

```ts
const dispatch = useDispatch()
// After a successful save:
dispatch(MarkSavedCommand)        // snapshots current doc as baseline; flips dirtyAtom to false
```

`MarkSavedCommand` is part of the built-in command set. Implementation: it captures `editor.getJSON()` into the package-internal `lastSavedAtom`; `dirtyAtom` is `Atom.map(([doc, saved]) => !equal(doc, saved))`.

#### Persistence wiring (consumer-side, documented in README)

```tsx
const PersistenceWiring = ({ lessonId }: { lessonId: string }) => {
  const docResult = useEditorSlice(slices.docAtom, { debounceMs: 1500 })
  const dispatch = useDispatch()
  useEffect(() => {
    if (Result.isFailure(docResult)) return                       // log & skip
    saveLesson(lessonId, docResult.value)
      .then(() => dispatch(MarkSavedCommand))
      .catch((err) => toast.error(`Save failed: ${err.message}`))
  }, [docResult])
  return null
}
```

Five lines on the consumer side; package handles encoding, equality, debounce, and dirty tracking.

#### Side-channel content replacement

`SetContentCommand` is the sanctioned way to programmatically replace the doc (post-conflict reload, paste-from-elsewhere, AI rewrite). It:

- Validates `newContent` against `schema.Document` (`ParseError` on invalid input).
- Captures `previousContent = editor.getJSON()` in the result.
- `apply`: `chain.setContent(newContent).run()`.
- `applyReverse`: `chain.setContent(previousContent).run()`.
- Records as one history entry — Cmd-Z reverts to the prior content.

#### Conflict handling — out of scope for v1

Last-write-wins, reload-on-conflict, OT/CRDT — all consumer policy. The package provides `SetContentCommand` for "replace the doc"; consumers build their conflict UX on top.

#### Static HTML (non-editable views)

Re-exported from `@tiptap/core`:

```ts
export { generateHTML } from "@tiptap/core"
// Usage in a view-only page:
const html = generateHTML(jsonDoc, lessonSchema.tiptapExtensions)
```

For SSR / static sites that need to render the lesson without a live editor.

### 10. Failure handling, pending state, and async UX

Three concerns are kept distinct: dispatch return shape, pending/cancellation, and partial-state recovery on async failure.

#### Dispatch surface

```ts
// src/react/hooks.ts (signatures)
useDispatch():        <In, Out, Err>(cmd, input) => Effect<Out, Err>
useDispatchPromise(): <In, Out, Err>(cmd, input) => Promise<Result<Out, Err>>
useCommandErrors():   (handler: (event: CommandFailed) => void) => void   // subscribe
```

A `CommandErrorHandler` Layer service is part of `TiptapLayer`. Its job is the safety net: any `dispatch` whose Effect fails *and* whose caller did not `Effect.catch*` it ends up here. The default handler logs and emits a typed `CommandFailed` event onto a `PubSub` consumers can subscribe to via `useCommandErrors`. The package ships **no UI** — consumers wire the event stream to their app's toast/notification system in ~5 lines.

#### Pending state

```ts
// Atom keyed by Command op. Reads true if any in-flight dispatch of that op exists.
slices.commandPendingAtom(op: string): Atom<boolean>

// Hook for component-local consumption
useCommandPending(cmd: Command): boolean
```

The executor maintains a `Map<op, Set<Fiber>>` of in-flight dispatches; the slice atom projects size > 0. Equality-checked, so unrelated dispatches don't notify subscribers of a different op.

**Concurrency policy** (per-Command, declared at `defineCommand` time):

- `"block-while-pending"` (default): repeat dispatch returns `CommandBusyError`.
- `"queue"`: dispatches stack and run sequentially.
- `"interrupt-and-replace"`: in-flight fiber is interrupted; new dispatch starts.
- `"allow-concurrent"`: run in parallel.

```ts
defineCommand({
  op: "ai.complete",
  concurrencyPolicy: "interrupt-and-replace",   // search-as-you-type style
  // ...
})
```

**Cancellation on editor disposal**: automatic. The executor's runtime is bound to the editor atom's Scope; on disposal, the runtime closes and every in-flight fiber is interrupted. No consumer wiring needed.

#### Partial-state recovery on async failure

Two-tier:

**Default (C1) — author's responsibility.**
A Command's `forward` either fully succeeds or leaves the editor unchanged. Pure `defineEditorCommand`s satisfy this for free (PM rejects bad chains). General `defineCommand`s must self-clean on failure.

**Opt-in (C3) — `transactional: true` with PM-meta tagging.**
A Command marked `transactional: true` runs inside a context that tags every transaction it dispatches with a unique meta key. On failure, the executor walks the doc's transaction history (cached in the bus) and applies the inverse of every tagged transaction, in reverse order. Concurrent user-input transactions are *not* tagged and are *not* rolled back; their positions shift through PM mapping.

```ts
defineCommand({
  op: "ai.complete",
  transactional: true,
  // ...
})
```

**Trade-off accepted in v1**: if the user types during a long-running transactional Command and the Command fails, the user's typing is preserved but at a position shifted by the rolled-back ops. Documented; rare enough; acceptable. Heavy-handed alternative `blockUserInputDuringForward: true` is available as an opt-in flag on the Command.

#### What we don't ship

- No built-in toast/notification UI (`useCommandErrors` exposes the stream; consumers wire it).
- No optimistic-UI infrastructure beyond `transactional` rollback. Optimistic mutations across the network are out of scope for v1 (matches the Command pattern doc's Phase 3+ note).

---

## Package layout

```
packages/tiptap-effect/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                # Public API barrel
│   ├── runtime.ts              # editorRuntime, TiptapLayer
│   ├── editor.ts               # editorAtomFamily, mount/unmount, transaction funnel
│   ├── transaction-bus.ts      # SubscriptionRef-backed bus + slice helpers
│   ├── slices.ts               # selectionAtom (SelectionInfo), selectedTextAtom, selectedNodeAtom, hasSelectionAtom, isCollapsedAtom, isActiveAtom, docAtom (Result<Doc, ParseError>), htmlAtom, plainTextAtom, dirtyAtom, focusAtom
│   ├── persistence.ts          # lastSavedAtom, MarkSavedCommand, SetContentCommand
│   ├── command.ts              # Command type, defineCommand, defineEditorCommand
│   ├── command-sequence.ts     # Sequence.atomic, Sequence.sequential, PartialFailure
│   ├── command-executor.ts     # CommandExecutor service (pending map, concurrency policy)
│   ├── command-error-handler.ts # CommandErrorHandler service + CommandFailed PubSub
│   ├── command-history.ts      # CommandHistory service (Effect-native, replaces PM)
│   ├── current-editor.ts       # CurrentEditor Context.Tag
│   ├── schema/
│   │   ├── define.ts           # defineEditorSchema → generates Document Schema + Tiptap extensions
│   │   ├── derive.ts           # tiptapAttrsFromSchema helper
│   │   ├── node-definition.ts  # NodeDefinition / MarkDefinition shapes
│   │   ├── migrate.ts          # migration pipeline runner
│   │   └── nodes/              # built-in node/mark definitions (paragraph, heading, bold, ...)
│   ├── commands/
│   │   ├── wrap-toggle-mark.ts
│   │   ├── insert-text.ts      # coalescing
│   │   ├── set-content.ts
│   │   ├── focus.ts
│   │   └── index.ts
│   ├── react/
│   │   ├── EditorScope.tsx
│   │   ├── TiptapView.tsx
│   │   ├── hooks.ts            # useDispatch, useEditorSlice, useHistory, useRawEditor
│   │   ├── node-view.tsx       # reactNodeView factory; child-Scope wiring
│   │   ├── node-view-atoms.ts  # nodeViewPropsAtomFamily over the bus
│   │   ├── node-view-hooks.ts  # useNodeViewProps; NodeViewContext
│   │   ├── decoration.tsx      # reactDecoration factory (same Scope mechanism)
│   │   └── index.ts
│   └── internal/
│       ├── strip-pm-history.ts
│       ├── coalesce.ts
│       └── render-counter.ts   # test helper
└── test/
    ├── schema/
    │   ├── define-editor-schema.test.ts  # generated Document is a discriminated union; round-trips
    │   ├── derive-attrs.test.ts          # node attrsSchema → Tiptap addAttributes
    │   ├── migrate.test.ts                # migrate hook runs before decode
    │   └── dev-sanity-check.test.ts       # devSchemaCheck warns on invalid doc
    ├── editor/
    │   ├── lifecycle.test.ts          # creation, destroy-once, family reuse
    │   ├── surgical-update.test.ts    # setEditable, setOptions paths
    │   ├── transaction-funnel.test.ts # one listener; slice projections
    │   └── content-validation.test.ts # boundary decode at setContent
    ├── command/
    │   ├── round-trip.test.ts         # property test
    │   ├── undo-redo.test.ts
    │   ├── coalesce.test.ts           # InsertText merging
    │   ├── dry-run.test.ts
    │   ├── schema-validation.test.ts
    │   ├── sequence-atomic.test.ts    # fused chain; no partial state on failure
    │   ├── sequence-sequential.test.ts # rollback on failure; PartialFailure shape
    │   ├── sequence-nested.test.ts    # Sequences inside Sequences
    │   ├── concurrency.test.ts        # block-while-pending / queue / interrupt-and-replace
    │   ├── pending-state.test.ts      # commandPendingAtom; equality
    │   ├── error-handler.test.ts      # CommandFailed PubSub; default safety net
    │   ├── transactional-rollback.test.ts # tagged-tx rollback; user input preserved
    │   ├── disposal-interrupts.test.ts # editor dispose interrupts in-flight fibers
    │   ├── selection-capture.test.ts  # capturesSelection records SelectionInfo
    │   ├── set-content-undoable.test.ts # SetContentCommand reversible
    │   ├── reversibility-tristate.test.ts # notReversible vs skipOnUndo vs reversible
    │   ├── undo-toggle-a3.test.ts     # first Cmd-Z toasts; second within 3 s pops
    │   ├── undo-while-pending.test.ts # interrupt-and-continue
    │   └── replay.test.ts              # F1 + strict mode
    ├── persistence/
    │   ├── doc-atom.test.ts           # Result<Doc, ParseError>; debounce overload
    │   ├── dirty-tracking.test.ts     # markSaved + dirtyAtom transitions
    │   └── lazy-encode.test.ts        # docAtom doesn't encode unless subscribed
    ├── react/
    │   ├── render.test.tsx
    │   ├── strict-mode.test.tsx
    │   ├── lifecycle.test.tsx
    │   ├── rerender-guards.test.tsx
    │   ├── scope.test.tsx             # EditorScope multi-editor
    │   ├── locked-api.test.tsx        # useEditorSlice doesn't expose editor
    │   ├── node-view-lifecycle.test.tsx  # Scope ordering, unmount-before-destroy
    │   ├── node-view-rerender.test.tsx   # equality on derived props; no spurious renders
    │   └── node-view-data.test.tsx       # Atom.family sharing across NodeViews
    └── helpers/
        ├── happy-dom-setup.ts
        └── render-with-runtime.tsx
```

Public API exports:

```ts
// src/index.ts
export { editorAtomFamily, defineNode, type EditorSpec, type EditorId } from "./editor"
export {
  defineCommand,
  defineEditorCommand,
  type Command,
  type EditorCommand,
  Reverse,                 // sentinels: Reverse.notReversible, Reverse.skipOnUndo
  NotReversibleError,
} from "./command"
export { Sequence, type PartialFailure } from "./command-sequence"
export { editorRuntime, TiptapLayer } from "./runtime"
export { CommandExecutor } from "./command-executor"
export { CommandErrorHandler, type CommandFailed } from "./command-error-handler"
export { CommandHistory } from "./command-history"
export {
  defineEditorSchema,
  type EditorSchema,
  type NodeDefinition,
  type MarkDefinition,
} from "./schema/define"
export { tiptapAttrsFromSchema } from "./schema/derive"
export * as Commands from "./commands"
export * as Nodes from "./schema/nodes"
export {
  EditorScope,
  TiptapView,
  useEditorSlice,
  useDispatch,
  useDispatchPromise,
  useCommandPending,
  useCommandErrors,
  useHistory,
  useEditorSubscribe,
  useRawEditor,
  // NodeView / Decoration API
  reactNodeView,
  reactDecoration,
  useNodeViewProps,
} from "./react"
export * as Slices from "./slices"
export { generateHTML } from "@tiptap/core"
```

The package will be a workspace package (we'll set up pnpm workspaces at the repo root).

---

## Testing strategy

The user's four explicit requirements map directly to test categories. Each gets its own file and helper. Plus a Schema category and a locked-API category.

### Test category 1 — "Editor updates when dependencies change"

For each splittable dimension (`extensions`, `editable`, `editorProps`), prove:

1. Changing the source atom triggers the **expected** call on the editor.
2. Changing the source atom does **not** trigger calls on unrelated dimensions.

```ts
it("setEditable is called when editableAtom flips, no rebuild", () => {
  const r = Registry.make()
  const editableAtom = Atom.state(true)
  const spec = { ...baseSpec, editableAtom }
  const ed = r.get(editorAtomFamily(spec))
  const setEditable = vi.spyOn(ed._internal.editor, "setEditable")
  const destroy = vi.spyOn(ed._internal.editor, "destroy")

  r.set(editableAtom, false)
  expect(setEditable).toHaveBeenCalledWith(false, false)
  expect(destroy).not.toHaveBeenCalled()
})
```

### Test category 2 — "Doesn't re-render for unrelated reasons"

Render-counter tests against slice subscriptions:

- A counter subscribed to `selectionAtom`. Type 10 plain characters at end-of-doc. Assert renders ≤ 2 (initial + maybe one for caret advance).
- A counter subscribed to `isActiveAtom("bold")`. Type plain text. Assert renders === 1.
- A parent rerender does not remount the editor (atom identity stable).

### Test category 3 — "Editor is destroyed exactly once on disposal"

```ts
it("destroys exactly once on registry disposal", async () => {
  const r = Registry.make({ defaultIdleTTL: 0 })
  const ed = r.get(editorAtomFamily(spec))
  const destroy = vi.spyOn(ed._internal.editor, "destroy")
  const unsub = r.subscribe(editorAtomFamily(spec), () => {})
  unsub()
  await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
})

it("survives StrictMode double-mount with one live editor", async () => {
  const created: TiptapEditor[] = []
  // ... patch defineEditor to record
  render(<StrictMode><EditorScope ...><TiptapView /></EditorScope></StrictMode>)
  await act(() => Promise.resolve())
  expect(created.filter(e => !e.isDestroyed)).toHaveLength(1)
})
```

### Test category 4 — "Doesn't mess with React lifecycle"

- contenteditable's children are owned by ProseMirror (no React fibers in the subtree).
- Ref callback fires before paint (sentinel flag flipped before `useEffect` would have fired).
- Components above `<TiptapView />` can re-render freely; editor is not remounted.

### Test category 5 — Commands and history

- Forward: dispatching `ToggleBoldCommand` flips bold; history's `past` grows by one.
- Reverse: `useHistory().undo()` after a dispatch restores previous state; entry moves from `past` to `future`.
- Round-trip property test: random sequence of N commands followed by N undos, assert `Schema.encode(TiptapDocument)` of editor JSON equals initial.
- Coalescing: 10 consecutive `InsertTextCommand` calls within 500ms produce one history entry; one undo reverts all 10 characters.
- Branching: dispatch → undo → dispatch new command → assert `future` is empty.
- ManagedRuntime wiring: a command that `yield* Logger` works; running it without `Logger` in the layer is a **type error**.
- `dryRun(cmd)` doesn't mutate state; doesn't push to history.

### Test category 6 — Schema validation

- `setContent(invalidJson)` rejects with `ParseError` before touching the editor.
- `defaultContent` validation at `editorAtomFamily` construction.
- `defineNode` derivation: a node defined with `attrsSchema` round-trips attributes through `parseHTML` / `renderHTML`.
- Command `inputSchema` rejects bad input before `forward` runs.

### Test category 7 — Locked-down public API

- `useEditorSlice` return type does not include the raw editor (compile-time test via `expectTypeOf`).
- `useDispatch` return type is `Effect`, not `Promise`.
- `useRawEditor()` (no arg) is a type error; `useRawEditor({ unsafe: true })` works.
- A grep of `src/react/index.ts` shows no `editor` field in any returned object except `useRawEditor`'s return.

### Test infrastructure

- **Vitest** + `@testing-library/react` + `happy-dom`.
- **`@effect/vitest`** for `it.effect`, `Equal` testers.
- **No real timers** — `vi.useFakeTimers()` for TTL and coalescing tests; `act()` for React state.
- **Per-test `Registry.make()`** — never share state across tests.
- A `render-with-runtime.tsx` helper wires `RegistryProvider` + `EditorScope` for component tests.

---

## Implementation steps (rough order)

Each step ships test-first.

### Step 1 — Project bootstrap

- pnpm workspace at the repo root with `packages/tiptap-effect`.
- TS strict, Vitest with happy-dom, `@effect/vitest`.
- Peer deps: `effect`, `@effect-atom/atom`, `@effect-atom/atom-react`, `@tiptap/core`, `@tiptap/pm`, `react`, `react-dom`. Pin in dev for tests.

### Step 2 — Schema layer

- `TiptapDocument`, `NodeT`, `Mark` (recursive).
- `tiptapAttrsFromSchema` derivation helper.
- `defineNode({ name, attrsSchema, ... })` returning a Tiptap-compatible Node.
- A handful of built-in nodes (paragraph, heading, text) with Schemas.
- Tests: category 6.

### Step 3 — Runtime + transaction bus

- `TiptapLayer` (initially with `TransactionBus.Default` only).
- `editorRuntime = Atom.runtime(TiptapLayer)`.
- `TransactionBus` service (`SubscriptionRef`-backed per editor id).
- Tests: subscribing to bus emits on synthetic transactions.

### Step 4 — `editorAtomFamily`

- Construct editor with `element: null`, validate `defaultContent` through Schema.
- Wire single `onTransaction` listener → bus.
- `addFinalizer` for destroy.
- Surgical update for `editableAtom`, `editorPropsAtom`.
- `withoutPmHistory(extensions)` filter.
- Tests: category 1, 3.

### Step 5 — Slice atoms

- `selectionAtom`, `isActiveAtom`, `docAtom`, `focusAtom`, `canExecuteAtom(cmd)`.
- All as `Atom.map` over the bus, with equality.
- Tests: category 2.

### Step 6 — Command type and executor

- `defineCommand`, `Command<Op, In, Out, Err, R>`.
- `defineEditorCommand` for pure-editor Commands (chain-based `apply` / `applyReverse`); the resulting Command exposes `_chain` metadata that `Sequence.atomic` consumes.
- `CurrentEditor` Tag.
- `CommandExecutor.run / undo / redo / dryRun / history`.
- `CommandHistory` (Effect-native; coalescing; branching).
- Tests: category 5.

### Step 7 — Sequence combinators and built-in commands

- `Sequence.atomic([...])` — fuses pure-editor Commands' chains into one PM transaction. Type-level constraint: only accepts `EditorCommand`s.
- `Sequence.sequential([...])` — runs general Commands in order; auto-rollback on failure with sequential reverses; yields `PartialFailure { failedAt, rolledBackThrough, irreversible? }`.
- Nested Sequences (Sequences inside Sequences) supported automatically since Sequences *are* Commands.
- Built-ins: `ToggleMarkCommand(name)`, `InsertTextCommand` (with `coalesceKey`), `SetContentCommand`, `FocusCommand`, `BlurCommand`, `SetLinkCommand`, `ClearContentCommand`, `SetHeadingCommand`. Most are `defineEditorCommand` so they can compose into atomic Sequences.
- Tests: round-trip property tests; sequence-atomic / sequential / nested.

### Step 8 — React layer

- `EditorScope` provider + scoped context.
- `<TiptapView />` consuming the scope.
- Hooks: `useEditorSlice`, `useDispatch`, `useDispatchPromise`, `useHistory`, `useEditorSubscribe`, `useRawEditor` (with `unsafe: true` gate).
- Tests: category 2, 3, 4, 7.

### Step 9 — NodeView and Decoration support

- `reactNodeView` factory: opens child Scope of editor's atom Scope, mounts `createRoot` inside PM-managed DOM, registers `root.unmount` finalizer, re-provides `RegistryProvider` + `ScopedEditorContext` + `NodeViewContext` inside the new root.
- `nodeViewPropsAtomFamily` derived atom over the transaction bus.
- `useNodeViewProps` hook returning typed `attrs` (from the node's `attrsSchema`) + `selected` + `getPos` + `unsafe.node`.
- `reactDecoration` factory using the same Scope mechanism.
- Tests: NodeView lifecycle (Scope ordering, ordering of `root.unmount` before `editor.destroy`), re-render guards (sibling NodeViews don't re-render on unrelated transactions), `Atom.family` sharing of fetched data across NodeViews, StrictMode survival.

### Step 10 — Documentation & examples

- Top-level `README.md` with toolbar example: dispatch `ToggleBoldCommand` from a button, render `useEditorSlice(slices.isActiveAtom("bold"))` for the active state, render-counter assertion in the example proving zero rerenders during plain typing.
- `examples/` with a runnable Vite app (manual verification only).

### Step 11 — Verification pass

- Coverage > 90% on `src/editor.ts`, `src/command*.ts`, `src/slices.ts`, `src/schema/*.ts`.
- Performance smoke: 1000-character paste, render counter for a static toolbar = 0.
- Memory smoke: mount/unmount 100 editors, assert all destroyed.
- Type-only assertion suite (`tsd` or `expectTypeOf`) for the locked-down public API.

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tiptap's `editor.mount(el)` semantics drift across versions | Low | Pin `@tiptap/core` in peer range with caret on minor; CI runs against the pinned version. The `.refs/tiptap` submodule is the source of truth. |
| Our history semantics confuse users used to PM history | Med | Documented prominently: "we replace PM history; one undo stack, all of it Effect-typed." Coalescing settings are configurable. |
| `Schema.decode` overhead on every transaction | Low | We only decode at boundaries (initial content, `setContent`, persistence) — *not* on every transaction. Slice atoms operate on the live PM state, not on decoded JSON. |
| `tiptapAttrsFromSchema` doesn't cover every edge case in the wild | Med | Start with simple struct-of-primitives nodes; ship `defineNode({ attrs: rawSpec })` as a fallback for nodes that need full control. |
| Effect `Scope` finalizer doesn't fire if registry is GC'd without explicit dispose | Low | `RegistryProvider` from `@effect-atom/atom-react` handles disposal on unmount; document explicit `registry.dispose()` for non-React usage. |
| Single-listener funnel adds latency vs direct `editor.state` reads | Low | Slice atoms are pull-based (`Atom.map` is lazy). Reactive consumers re-evaluate; direct imperative reads still go through `editor.state` / `editor.can()` etc. (commands have `CurrentEditor` injected). |
| StrictMode double-invocation re-creates the editor | Med | Atom registry deduplicates by atom identity; `setIdleTTL("2 seconds")` covers the gap between unmount and remount. Test category 3 verifies. |
| Coalescing window too aggressive/lenient | Low | Configurable per command (the `coalesceKey` callback). Default 500ms; tests pin specific scenarios. |
| Locked-down API forces escape-hatch usage in real apps | Med | We measure: every `useRawEditor` call in the host app is a missing built-in command. PR review reads them as a backlog. We expand built-ins as the backlog grows. |
| NodeView React root lifecycle drifts from PM's view lifecycle (orphan roots, late `getPos`) | Med | Child-Scope mechanism enforces ordering: NodeView roots unmount before `editor.destroy()`. Tests verify Scope hierarchy and ordering of `root.unmount` calls. PM's `destroy()` callback closes the corresponding child Scope deterministically. |
| 100+ NodeViews each running `nodeAt(pos)` per transaction adds CPU cost | Low | `nodeAt` is O(log n); Atom.map equality prevents React rerenders. Perf test pinned in category 2: 100 mention chips, 1000-character paste, render-counter on a static toolbar = 0. Optimise only if measured. |
| `createRoot()` for many NodeViews on initial render causes jank | Low | Async render lets React batch initial commits. No `flushSync`. If a single large embed flickers, a CSS `min-height` on the placeholder masks it without forcing sync. |

---

## Open questions (remaining)

1. **`Atom.family` GC** — the family API uses `WeakRef` + `FinalizationRegistry`. Are short-lived editors (open-modal-close-modal) reliably GC'd, or do we need explicit "release" calls? **Tentative**: rely on `setIdleTTL` + family GC; add a `useEditorScope` cleanup test that asserts memory release after N modal cycles.
2. **`coalesceKey` design** — should the coalesce window be per-command or global? **Tentative**: per-command (each command declares its own `coalesceKey`); global default override is a config knob.
3. **Branching policy** — when undoing past N commands then dispatching a new command, the `future` is dropped. Should we offer a "branching" mode that keeps a tree? **Tentative**: linear by default; revisit if a real use case appears (probably never).

Decided (no longer open):

- Single editor per page → multi-editor: **`Atom.family` keyed by `EditorId`, scoped by `<EditorScope>`**.
- SSR: **out of scope**; `defaultContent` validated through Schema at construction.
- Yjs/Hocuspocus: **v2** — see `.omc/plans/tiptap-effect-collab-v2.md`.
- Long-term version snapshots with tiered retention: **v2** — see `.omc/plans/tiptap-effect-version-history-v2.md`.
- `dispatch` return type: **`Effect`**, with `useDispatchPromise` as ergonomic helper.
- Command serialisation: **via Schema** (`Schema.encode(commandRecord)`).
- Custom Tiptap extensions: **build our own Effect-native versions** if the vanilla ones don't fit.
- Replacing chain/commands API: **lock down by default; `useRawEditor({ unsafe: true })` is the only escape hatch**.
- PM history: **disabled by default; replaced with Effect-native `CommandHistory`**.

---

## Acceptance criteria

A reviewer should be able to verify each of these without running the code:

**Schema**
- [ ] `defineEditorSchema({ nodes, marks })` generates a discriminated-union `Document` Schema; type-level check confirms `Document.Type["content"][number]` is the union of registered nodes.
- [ ] Tiptap node/mark extensions are auto-generated from each definition's `attrsSchema`; `editor.getJSON()` round-trips through `Schema.encode/decode`.
- [ ] `defaultContent` failing schema decode yields `EditorInitError` (editor is not constructed).
- [ ] `migrate` hook runs before decode; legacy doc with renamed node passes through after migration.
- [ ] `devSchemaCheck: true` logs a warning when a transaction produces an invalid doc; assertion: no warning under normal typing.
- [ ] An `extensions` entry that duplicates a node/mark from `schema` triggers a construction-time error.
- [ ] Including `History` in `extensions` is rejected; `EffectHistory` is the only sanctioned history extension.

**Editor**
- [ ] `editorAtomFamily(spec)` creates an editor lazily; `editor.destroy()` is registered as a Scope finalizer.
- [ ] Changing `editableAtom` calls `editor.setEditable(x, false)` and **does not** call `editor.destroy()`.
- [ ] Changing `extensionsAtom` triggers a rebuild — old editor destroyed exactly once, new editor created exactly once.
- [ ] PM history extension is filtered out of the extensions list before construction (assertion against the editor's installed plugins).

**Reactivity**
- [ ] `editor.on("transaction")` is wired exactly once per editor (assertion on EventEmitter listener count).
- [ ] Render counter subscribed to `selectionAtom` increments at most twice when typing 10 characters.
- [ ] Render counter subscribed to `isActiveAtom("bold")` does not increment when typing plain text.
- [ ] `selectionAtom` produces `SelectionInfo` (no PM `Selection` type leaks to public API; type-level test).
- [ ] `selectedNodeAtom` is non-null exactly when the selection is a `NodeSelection`.

**Commands and selection**
- [ ] `capturesSelection: true` on a Command records `SelectionInfo` in `CommandRecord` at dispatch.
- [ ] On `undo`, the captured selection is restored before reverse ops run (cursor visibly returns to its prior position).
- [ ] A Command without `capturesSelection` records nothing related to selection.

**React**
- [ ] StrictMode mount → unmount → mount yields exactly one live editor.
- [ ] `<TiptapView />` parent rerender does not remount the editor.
- [ ] `<EditorScope id="a">…</EditorScope><EditorScope id="b">…</EditorScope>` produces two distinct editors that do not share history or selection.

**Commands**
- [ ] `useDispatch()(ToggleBoldCommand, ...)` toggles bold and pushes a record to history.
- [ ] `useHistory().undo()` after a `ToggleBoldCommand` restores the previous bold state.
- [ ] Property test: random sequence of N commands followed by N undos restores initial doc JSON (checked via `Schema.encode`).
- [ ] Coalescing: 10 consecutive `InsertTextCommand` invocations within 500ms produce one history entry.
- [ ] `dryRun(cmd)` does not mutate editor state and does not push history.

**Sequence**
- [ ] `Sequence.atomic` of N `EditorCommand`s lands as **one** PM transaction (assertion: PM `dispatchTransaction` called exactly once for the run).
- [ ] `Sequence.atomic` failure leaves editor in original state (no partial commit visible).
- [ ] `Sequence.sequential` failure at step K rolls back steps 0..K-1 in reverse order; yields `PartialFailure`.
- [ ] `Sequence.atomic` only accepts `EditorCommand` at the type level (compile-time test using `expectTypeOf`).
- [ ] Nested Sequence (Sequence inside Sequence) records as one history entry; one undo reverts the whole tree.
- [ ] `Schema.encode(sequenceRecord)` produces `{ op, steps: [{op, input}, …] }`; round-trips through `decode`.

**Persistence**
- [ ] `docAtom` returns `Result<LessonDoc, ParseError>`; encode failure surfaces as `Result.Failure` (manually injected for the test).
- [ ] `docAtom` does not call `Schema.encode` until a subscriber actually reads it (lazy assertion via spy on encode).
- [ ] `MarkSavedCommand` flips `dirtyAtom` from `true` to `false`; subsequent edits flip it back.
- [ ] `SetContentCommand({ content })` is reversible: undo restores `previousContent`.
- [ ] `useEditorSlice(slices.docAtom, { debounceMs: 100 })` only fires the subscriber once for 10 keystrokes inside the window.

**Reversibility & history edges**
- [ ] `Reverse.notReversible` Command on Cmd-Z: first press toasts "Can't undo this action…", second press within 3 s pops & continues to next entry; record stays in audit, not redoable.
- [ ] `Reverse.skipOnUndo` Command on Cmd-Z: silently popped (no toast, no perceptible pause); next entry undoes immediately.
- [ ] Sequence with one `notReversible` step: whole Sequence is `notReversible`; A3 toggle behaviour applies.
- [ ] Sequence with `skipOnUndo` steps only (no `notReversible`): fully undoable; `skipOnUndo` steps' reverses are `Effect.void`; remaining steps run normally in reverse order.
- [ ] Cmd-Z while a Command is in-flight: in-flight fiber is interrupted, transactional rollback runs (if applicable), then undo proceeds to the entry below.
- [ ] Coalesce window broken by undo: `InsertTextCommand` after Cmd-Z starts a new history entry instead of merging.
- [ ] `redoableAtom` is `false` after a hard-irreversible record was popped via the A3 toggle (record didn't enter `future`).
- [ ] `replay(record, { strict: true })` yields `ReplayDivergenceError` if `Schema.encode(actualOutput) !== Schema.encode(record.output)`; non-strict mode succeeds with the actual result.

**Failure & async**
- [ ] An unhandled Command failure emits a `CommandFailed` event on the `useCommandErrors` stream (assertion: subscriber called once).
- [ ] `commandPendingAtom("op")` returns true while a dispatch is in flight, false on completion or failure.
- [ ] `concurrencyPolicy: "block-while-pending"` returns `CommandBusyError` for repeat dispatch.
- [ ] `concurrencyPolicy: "interrupt-and-replace"` interrupts the in-flight fiber and starts the new dispatch (in-flight Effect interruption verified by Fiber state).
- [ ] Editor disposal during an in-flight Command interrupts its fiber within one tick.
- [ ] `transactional: true` failure: tagged transactions reverted, untagged user-input transactions preserved (positions may shift through PM mapping).

**Locked API**
- [ ] No exported hook returns an object with an `editor` field, except `useRawEditor`.
- [ ] `useRawEditor()` (no arg) is a TS error; `useRawEditor({ unsafe: true })` works.
- [ ] Zero use of `forceUpdate`, no random `key=` props, no `setTimeout(destroy, 1)` hacks anywhere in the codebase.

**NodeViews**
- [ ] Every NodeView's React root is mounted on a child Scope of the editor's atom Scope (assertion on Scope hierarchy).
- [ ] On editor disposal, every NodeView's `root.unmount()` runs **before** `editor.destroy()` (ordering verified by spies).
- [ ] On node removal mid-doc, only that NodeView's child Scope closes; sibling NodeViews remain mounted.
- [ ] `useNodeViewProps` returns a typed `attrs` derived from the node's `attrsSchema`; raw PM `node` only via `unsafe.node`.
- [ ] Render counter inside a Mention NodeView does not increment when an unrelated paragraph is edited (derived-atom equality holds).
- [ ] Two `<MentionChip userId="alice" />` NodeViews share one in-flight `userAtom('alice')` fetch (single network call asserted).
- [ ] Inside a NodeView, `useRawEditor()` is also gated behind `{ unsafe: true }`; mutations from NodeView buttons go through `useDispatch(Command)`.
- [ ] StrictMode renders a NodeView, unmounts, remounts; only one live React root remains; no leaked roots after unmount.

---

## Verification steps

After implementation:

1. `pnpm --filter tiptap-effect typecheck` — clean.
2. `pnpm --filter tiptap-effect test` — green; coverage > 90% on `src/editor.ts`, `src/command*.ts`, `src/slices.ts`, `src/schema/*.ts`.
3. `pnpm --filter tiptap-effect test:types` — type-only suite passes (locked-API assertions).
4. Manual: example Vite app — toggle bold from a toolbar, type, confirm toolbar's render counter is 1 after 100 keystrokes.
5. Manual: React DevTools Profiler during a typing session; confirm `<TiptapView />` does not appear in the commit list.
6. Manual: `Cmd-Z` reverts the last command (not the last keystroke unless that's what was committed).

---

## Out of scope (explicitly)

- Authoring extensions that don't fit our `defineNode` model — consumers can drop down to `@tiptap/core` `Extension.create(...)` and pass it as a raw extension; we don't validate it.
- MCP server integration (the `frontcore-lms` Command plan covers that; this package's `Command` shape is intentionally compatible).
- Real-time collaboration / Yjs lifecycle — see `.omc/plans/tiptap-effect-collab-v2.md`.
- Long-term document version snapshots with tiered retention — see `.omc/plans/tiptap-effect-version-history-v2.md`.
- SSR rendering of editor content.

---

## Appendix: file references

- Tiptap `Editor` lifecycle: `.refs/tiptap/packages/core/src/Editor.ts:121` (constructor), `.refs/tiptap/packages/core/src/Editor.ts:161` (mount), `.refs/tiptap/packages/core/src/Editor.ts:610` (`dispatchTransaction`), `.refs/tiptap/packages/core/src/Editor.ts:766` (destroy).
- Tiptap React wrapper warts: `.refs/tiptap/packages/react/src/useEditor.ts:297` (`scheduleDestroy`), `.refs/tiptap/packages/react/src/EditorContent.tsx:127` (`forceUpdate`), `.refs/tiptap/packages/react/src/EditorContent.tsx:182` (random key remount).
- effect-atom Effect lifecycle: `.refs/effect-atom/packages/atom/src/Atom.ts:470` (effect atom Scope wiring), `.refs/effect-atom/packages/atom/src/internal/registry.ts:188` (idle-TTL sweep).
- effect-atom React hooks: `.refs/effect-atom/packages/atom-react/src/Hooks.ts:87` (`useAtomValue`), `.refs/effect-atom/packages/atom-react/src/RegistryContext.ts:22` (default registry), `.refs/effect-atom/packages/atom-react/src/ScopedAtom.ts:36` (`ScopedAtom.make`).
- Command pattern source: `/Users/sebastian/Documents/frontcore-workspace/frontcore-lms/.omc/plans/command-pattern.md`.
