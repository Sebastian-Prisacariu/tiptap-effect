# Code Quality Review

Timestamp: 2026-04-28 14:43 UTC+2

Scope: `packages/tiptap-effect`

## Verdict

The package has a promising shape: a small schema layer, a command abstraction,
Effect services for runtime state, and React bindings that keep most Tiptap
access behind typed hooks. TypeScript build/typecheck passes.

The main concern is that several APIs present editor-scoped behavior while core
runtime state is global. That creates correctness issues for multi-editor usage,
undo/redo, concurrency policies, and pending/error subscriptions.

## Findings

### Critical: command history is global, not editor-scoped

`CommandHistory` stores one `past` and one `future` stack for the whole runtime.
`CommandExecutor.undo(editor)` pops from that global stack and applies the
reverse operation to the editor passed at call time.

Impact: in a multi-editor page, undo in editor A can pop editor B's last command
and reverse it against editor A. `undoableAtom` and `redoableAtom` are also
global, so toolbar state can reflect another editor.

Recommended direction: key history state by `EditorId`, or make each editor own
an isolated executor/history scope.

### High: command concurrency state is global by operation

`pendingOps`, `perOpFibers`, and `perOpSemaphores` are keyed only by command
`op`. The same operation in different editors can block, queue, or interrupt
each other. `commandPendingAtom(op)` has the same global behavior.

Impact: concurrent editors are not isolated. A slow save, insert, or async
command in one editor can affect another editor that happens to run the same
command operation.

Recommended direction: key pending/fiber/semaphore state by editor plus op, and
use atomic updates for reservation/check-and-create paths.

### High: concurrency maps have race windows

The executor mutates plain `Map` and `WeakMap` instances from concurrent fibers.
`getOrCreateSemaphore` can create multiple semaphores for the same op under
parallel dispatch. `block-while-pending` checks pending state and marks pending
in separate steps.

Impact: queue and block semantics can silently fail under simultaneous dispatch.

Recommended direction: use `Ref`/`Ref.modify`, one combined state object, or STM
for atomic updates.

### High: transactional rollback is ambient and fragile

Transactional commands install a wrapper around `editor.view.dispatch` and store
one transactional context per editor. Any transaction dispatched while the
context is active is captured. Overlapping transactional commands can overwrite
or clear each other's context.

Impact: rollback can capture unrelated transactions or miss the intended ones,
especially for async commands, concurrent commands, or user activity during a
command.

Recommended direction: serialize transactional commands per editor, or replace
the single context with a token/stack model that attributes transactions
precisely.

### High: interrupt paths do not wait for cleanup

`interruptAllForEditor` uses fire-and-forget interruption. `undo` continues to
pop history immediately after requesting interruption, and editor disposal can
destroy the editor before interrupted command cleanup and transactional rollback
finish.

Impact: rollback can race with undo or editor destruction.

Recommended direction: await interruption where rollback correctness matters,
especially before undo and before `editor.destroy()`.

### Medium: failed Tiptap chains can be recorded as successful commands

`defineEditorCommand` calls `chain.run()` for forward and reverse operations but
does not check the boolean result.

Impact: a Tiptap command that returns `false` can still be treated as successful
and pushed into history.

Recommended direction: check the result of `run()` and fail the command when
Tiptap reports failure.

### Medium: command output schemas are not enforced

Commands define `outputSchema`, but the executor validates only input. Outputs
are stored into command history without decoding.

Impact: the API appears to offer runtime output validation, but invalid outputs
can reach undo/redo paths.

Recommended direction: decode command outputs before recording history.

### Medium: `useCommandErrors` is broken or racy

The direct package test suite consistently fails at
`test/react/pending-and-errors.test.tsx`: the handler receives no failure events
after a failing command.

Impact: consumers cannot rely on the React error hook for telemetry or UI error
surfacing.

Recommended direction: expose a stable read-only stream/atom for command errors
with subscription readiness and lifecycle handled by Effect scope.

### Medium: public API has incomplete or misleading fields

`EditorSpec.editorProps` is declared but not passed into `new TiptapEditor`.
`focusAtom` reads `sourceMeta.includes("focus")`, but snapshots currently always
set `sourceMeta` to an empty array. `EditorScope` receives both `id` and
`spec.id`, which can diverge.

Impact: consumers may configure fields that have no effect, or read atoms that
cannot produce the documented value.

Recommended direction: either implement these surfaces fully or remove them
until they are supported.

### Medium: React slice hooks should memoize derived atoms

`useEditorSlice` calls `factory(id)` during render, while `useEditorSubscribe`
memoizes the same pattern.

Impact: factories that allocate derived atoms can cause subscription churn and
unstable behavior.

Recommended direction: memoize `factory(id)` consistently.

### Medium: dirty tracking is expensive on the hot path

`dirtyAtom` stringifies current and saved document JSON on stream events.

Impact: dirty tracking is O(document size) on every relevant transaction, which
can become costly for large documents.

Recommended direction: track document versions, transaction counters, hashes, or
dirty state transitions instead of repeatedly stringifying full JSON.

### Low: error and event APIs should be tightened

Error classes are plain tagged classes rather than Effect `Data.TaggedError`.
`CommandExecutor` exposes writable `PubSub` values, allowing consumers with
service access to publish synthetic events.

Impact: error ergonomics and event encapsulation are weaker than they need to
be.

Recommended direction: use structured tagged errors and expose read-only streams
or queues for event consumers.

### Low: type safety relies on broad casts in core paths

Several core and public generic paths use broad casts and `any`, especially
around Tiptap interop, erased command records, and schema definitions.

Impact: some of the package's advertised type safety is bypassed internally.

Recommended direction: replace avoidable `any` with `unknown`, narrower helper
types, or explicit adapter types around Tiptap boundaries.

## Verification Notes

- `pnpm --filter tiptap-effect typecheck` passed, but the workspace filter also
  selected `packages/tiptap-effect-manual` because both packages currently share
  the same package name.
- `pnpm build` from `packages/tiptap-effect` passed.
- `pnpm test` from `packages/tiptap-effect` failed only on
  `test/react/pending-and-errors.test.tsx`.

## Recommended Fix Order

1. Make command history, undo/redo state, pending state, fibers, semaphores, and
   A3 state editor-scoped.
2. Make concurrency reservation atomic.
3. Make interruption await cleanup where rollback/undo/disposal correctness
   depends on it.
4. Rework transactional rollback so overlapping commands cannot share one
   ambient context.
5. Check Tiptap chain results and validate command outputs.
6. Fix `useCommandErrors` and expose command events as read-only streams.
7. Remove or implement incomplete public API fields.
