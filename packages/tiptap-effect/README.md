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
