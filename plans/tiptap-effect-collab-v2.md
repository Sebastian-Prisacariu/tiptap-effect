# `tiptap-effect` v2: Real-time collaboration (Yjs / Hocuspocus)

> **Status**: Future / not scheduled. Captured to make sure v1 design choices don't paint us into a corner.

## Why this is v2 not v1

Yjs introduces a second source of mutation (remote ops) that doesn't go through our `CommandExecutor`. Designing for that from day one would force us to:

- Treat every transaction as potentially-remote and route accordingly.
- Reconcile our `CommandHistory` with Yjs's CRDT history (they're fundamentally different — CRDT history is a graph, ours is a linear stack).
- Decide how to surface remote-presence state (cursors, selections of other users).
- Deal with awareness protocols and provider lifecycles (WebSocket reconnect, IndexedDB persistence, etc.).

These are substantial design decisions. v1 stays single-user so we can lock the Command/atom story first; v2 layers collaboration on top.

## What v1 does to keep v2 viable

These choices in v1 explicitly leave room for v2:

1. **Editor is constructed with arbitrary extensions.** Adding `Collaboration` and `CollaborationCursor` extensions later is a config change at the call site, not a rewrite.
2. **`onTransaction` funnel inspects `tr.getMeta(...)`.** Yjs marks its remote-applied transactions with a meta key (typically `addToHistory: false` and a `y-sync$` plugin marker). Our funnel can branch on that and skip pushing remote-origin transactions to `CommandHistory`.
3. **`CommandHistory` is bounded and pluggable.** A v2 implementation can swap the in-memory stack for a Yjs-aware history that defers to Yjs's own undo manager (`Y.UndoManager`) for collaborative undo.
4. **`SubscriptionRef`-backed `TransactionBus` is the only reactive surface.** Adding a "remote presence" atom is just another `Atom.map` over (or sibling of) the bus.
5. **No assumptions about where the `Editor` lives.** It's atom-owned with a Scope finalizer; a Yjs provider's lifetime can attach to the same Scope by having the provider be created inside the editor atom and registered as a finalizer.

## What changes in v2 (sketch)

### Architecture additions

```
┌──────────────────────────────────────────────────────────┐
│  CollaborationLayer (Effect Layer)                       │
│  - YDocService          (Y.Doc per editor)               │
│  - ProviderService      (WebSocket / WebRTC / Hocuspocus)│
│  - AwarenessService     (remote cursors/selections)      │
│  - PresenceBus          (emit awareness changes)         │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
EditorAtom (now reads from CollaborationLayer too)
   - extensions includes Collaboration({ document: yDoc })
                       + CollaborationCursor({ provider, user })
   - transaction funnel branches on remote vs local
```

### Command interactions

Two undo models compose:

- **Local commands** (toolbar, slash menus, agent actions): tracked in our `CommandHistory`. Forward inserts into the Y.Doc, which propagates to peers; reverse runs against the Y.Doc, which propagates an inverse.
- **Collaborative undo** (`Cmd-Z` only undoes *your own* changes, even after remote edits): backed by `Y.UndoManager`, scoped to the local user's origin. We expose this through the same `useHistory().undo()` API; the implementation switches based on whether collaboration is enabled.

The challenge: a single user-facing `undo()` button needs to do the right thing across both stacks. Likely answer: `useHistory().undo()` defers to Y.UndoManager when collab is enabled (because it correctly handles the CRDT) and falls back to our linear history when not. Local-only Commands (e.g. opening a sidebar — not in the doc) stay in the linear history regardless.

### Persistence

Yjs's IndexedDB persistence runs alongside our schema-validated boundaries. The schema decode at `setContent` time still applies to the *initial* doc, but post-load Yjs is the source of truth. We never `setContent` after collab is initialised.

### Awareness / presence

Awareness state is wrapped in `AwarenessAtom`:

```ts
export const awarenessAtom = (id: EditorId) =>
  Atom.subscribable((get) => {
    const provider = get(providerAtomFamily(id))
    return Atom.subscribable.fromEmitter(provider.awareness, "change")
  })
```

Slice atoms like `remoteCursorsAtom`, `peersAtom` derive from it.

### Open questions for v2

1. Hocuspocus vs raw `y-websocket` — Hocuspocus has nicer auth/permission integration, but adds a Node service we'd have to host.
2. Server authoritative vs P2P — affects how we handle access control. Likely server authoritative via Hocuspocus extensions.
3. Offline support — IndexedDB persistence is straightforward, but reconnect with conflict resolution is its own design.
4. Schema enforcement under collab — Yjs doesn't natively know about our `TiptapDocument` schema; we either validate on the wire (server-side) or rely on local schema enforcement and accept that a malicious client could push invalid ops.
5. Permissions per node/range — selective edit access ("students can comment, only TAs can edit") needs ProseMirror-level enforcement that Yjs doesn't help with.

## When to pull this forward

Pull v2 forward when **one** of:

- A real collaborative use case ships (multi-author course editing, comment threads, real-time AI co-authoring).
- We hit a v1 design decision that would foreclose a v2 path — flag it, design v2 around the constraint instead of letting it leak into v1.

Until then, v1 is single-user and we keep this doc honest.

## Related

- `.omc/plans/tiptap-effect-package.md` — v1 design.
- `.refs/tiptap/packages/extension-collaboration/` — Tiptap's official Yjs binding.
- Hocuspocus: <https://tiptap.dev/docs/hocuspocus>.
- Y.UndoManager: <https://docs.yjs.dev/api/undo-manager>.
