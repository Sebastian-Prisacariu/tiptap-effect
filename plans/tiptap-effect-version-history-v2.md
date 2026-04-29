# `tiptap-effect` v2: Document version history with tiered retention

> **Status**: Future / not scheduled. Captured here so v1 design choices don't paint us into a corner.

## Why this is v2 not v1

Live Cmd-Z undo and "give me the doc as it looked three weeks ago" are different features:

| | Command history (v1) | Version history (v2) |
|---|---|---|
| Lifetime | Session-scoped, in-memory | Persistent, multi-day/month |
| Granularity | Per-command (typing-grouped via coalesce) | Per-snapshot (periodic + on-save) |
| Bound | Count (default 1000) | Tiered retention (see below) |
| Surface | `Cmd-Z` / `Cmd-Shift-Z` | "Version history" panel UI |
| Storage | Memory only | Consumer-provided persistence |
| Reversibility | Inverse functions per Command | Whole-doc replacement via `SetContentCommand` |

They serve different user needs. v1 ships the live-undo Command history; v2 layers persistent version snapshots on top.

## Tiered retention (the algorithm)

Captured verbatim from the v1 design discussion:

```
last hour       :  keep all snapshots
last day        :  keep hourly snapshots
last month      :  keep daily snapshots
last 3 months   :  keep weekly snapshots
last year       :  keep monthly snapshots
older           :  delete
```

Pruning runs on a schedule (e.g. once per hour while the editor is mounted, plus on every snapshot creation). The pruner walks snapshots oldest-to-newest and keeps the first one in each bucket; everything else in that bucket is deleted.

## Snapshotting policy

Snapshots fire on:

1. **Time tick** — every N minutes while the editor is dirty (default: 1 minute).
2. **Save event** — every successful `MarkSavedCommand` writes a snapshot tagged `{ source: "save" }`.
3. **Significant action** — Commands can declare `versionSnapshot: true` to force a snapshot before/after their forward (e.g. `SetContentCommand` taking AI-generated content).
4. **Manual** — user clicks "save version" in the version-history panel.

Each snapshot includes:
- The validated `Schema.encode(schema.Document)` of `editor.getJSON()`.
- A timestamp (UTC, ms).
- An `actor` (same `Actor` shape as the Command pattern: `user` / `mcp` / `system`).
- An optional `label` (user-provided "before AI rewrite", or auto-generated from the most recent Command's `describe`).
- A `parentSnapshotId` (forms a chain — useful for branching previews).

## Architecture additions

```
┌──────────────────────────────────────────────────────────┐
│  VersionHistory (Effect Service, part of TiptapLayer)    │
│  - snapshot()   — creates a snapshot now                 │
│  - prune()      — applies the tiered retention algorithm │
│  - list(filter) — query (since, until, actor, label)     │
│  - restore(id)  — runs SetContentCommand with snapshot   │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────┐
│  VersionPersistence (consumer-provided Layer)            │
│  - put(snapshot)                                         │
│  - get(id)                                               │
│  - list(filter)                                          │
│  - delete(ids)                                           │
└──────────────────────────────────────────────────────────┘
```

Storage is consumer-provided (IndexedDB for offline drafts, Postgres for server-side, S3 for archival, etc.). The package ships a default `IndexedDBVersionPersistence` for the common case but doesn't depend on it.

## React surface

```ts
// Atoms
slices.versionHistoryAtom: Atom<ReadonlyArray<VersionSnapshot>>   // sorted desc
slices.canBranchAtom: Atom<boolean>                                // experimental

// Hooks
useVersionHistory(): { list, restore, snapshot, label }
```

A built-in `<VersionHistoryPanel />` component is **not** in v2 scope; the package exposes the data and the consumer renders the UI in their app's design system.

## Restoration

`restoreVersion(id)` is implemented as a Command:

```ts
defineCommand({
  op: "tiptap.version.restore",
  inputSchema: Schema.Struct({ snapshotId: Schema.String }),
  outputSchema: Schema.Struct({
    previousContent: TiptapDocument,
    restoredFromSnapshot: SnapshotMetadata,
  }),
  capturesSelection: false,
  describe: ({ snapshotId }) =>
    `Restore version from ${formatTime(snapshotId)}`,
  forward: ({ snapshotId }) => Effect.gen(function* () {
    const persistence = yield* VersionPersistence
    const editor = yield* CurrentEditor
    const snapshot = yield* persistence.get(snapshotId)
    const previousContent = editor.getJSON()
    yield* SetContentCommand.forward({ content: snapshot.content })   // composes
    return { previousContent, restoredFromSnapshot: snapshot.metadata }
  }),
  reverse: ({ snapshotId }, { previousContent }) =>
    SetContentCommand.forward({ content: previousContent }),          // restoring is undoable
})
```

A restore is itself a Command, so it lives in the live undo stack — the user can Cmd-Z a restore that wasn't what they wanted.

## What v1 does to keep v2 viable

These v1 choices explicitly leave room for v2:

1. **`SetContentCommand` is a real Command** with `previousContent` captured for reverse — `restoreVersion` is just `SetContentCommand` with content fetched from a snapshot.
2. **`docAtom: Atom<Result<Doc, ParseError>>`** is the source `VersionHistory.snapshot()` reads from — already validated and equality-checked.
3. **`MarkSavedCommand`** as a hook point — v2 wires snapshot-on-save by listening to its dispatch.
4. **Layer-based architecture** — `VersionHistory` slots into `TiptapLayer` alongside `CommandHistory` without restructuring.
5. **Effect Schema-typed snapshots** — snapshot serialisation reuses `schema.Document` Schema; no separate snapshot format.
6. **Actor identity propagation** — every Command carries an `Actor` (Command pattern doc); snapshots capture the same identity for "who created this version".

## Open questions for v2

1. **Branching restores** — when the user restores an old version, does the live timeline branch (new edits go forward from the restored point, old future preserved as a separate branch) or does it linearise (old future becomes part of history-before-restore)? Linear is simpler; branching is what Google Docs does. Probably linear for v2.
2. **Per-snapshot delta vs full snapshot** — store full `Document` JSON every snapshot (simple, larger), or store deltas vs the previous snapshot (smaller, requires reconstruction). Probably full for v2; revisit if storage cost matters.
3. **Cross-user / collaborative snapshots** — if v2 collab also lands, how do per-user vs shared version histories interact? Open until the collab plan crystallises.
4. **Server-side snapshotting** — should snapshots be authored client-side and synced, or server-side from the persisted doc? Probably client-side for offline support.
5. **Pruning during edit storms** — if the user makes 1000 commits in an hour, the "keep all in last hour" bucket bloats. Cap per-bucket (max 60 in the per-minute bucket).

## When to pull this forward

Pull v2 forward when **one** of:

- A real product need surfaces ("students need to recover yesterday's draft").
- A v1 design decision would foreclose a v2 path — flag it and design around the constraint.
- Compliance / audit requirements demand point-in-time recovery beyond the live undo window.

Until then, v1 is bounded-live-undo and we keep this doc honest.

## Related

- `.omc/plans/tiptap-effect-package.md` — v1 design (Command history, `SetContentCommand`, persistence).
- `.omc/plans/tiptap-effect-collab-v2.md` — v2 collaboration plan; some overlap on persistence and presence.
- The Command pattern's `CommandRecord` table at `frontcore-lms/.omc/plans/command-pattern.md` — version snapshots are the user-doc analogue of the `CommandRecord` audit log.
