import { Chunk, Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { TransactionBus } from "../src/runtime/internal/transaction-bus"
import { EditorId, type TransactionSnapshot } from "tiptap-effect"

const mkSnapshot = (id: EditorId, n: number): TransactionSnapshot => ({
  editorId: id,
  docChanged: true,
  selectionSet: false,
  stateAfter: { tick: n },
  transaction: null,
  sourceMeta: [],
  at: n,
})

describe("TransactionBus", () => {
  const id = EditorId("editor-A")

  it("latest returns null before any push", () =>
    Effect.gen(function* () {
      const bus = yield* TransactionBus
      const snap = yield* bus.latest(id)
      expect(snap).toBeNull()
    }).pipe(Effect.provide(TransactionBus.Default), Effect.runPromise))

  it("latest returns the most recently pushed snapshot", () =>
    Effect.gen(function* () {
      const bus = yield* TransactionBus
      yield* bus.push(id, mkSnapshot(id, 1))
      yield* bus.push(id, mkSnapshot(id, 2))
      const latest = yield* bus.latest(id)
      expect(latest).not.toBeNull()
      expect(latest!.at).toBe(2)
    }).pipe(Effect.provide(TransactionBus.Default), Effect.runPromise))

  it("stream emits pushed snapshots", () =>
    Effect.gen(function* () {
      const bus = yield* TransactionBus
      const fiber = yield* Effect.fork(
        bus.stream(id).pipe(Stream.take(2), Stream.runCollect),
      )
      // Yield to let the forked fiber subscribe before we push.
      yield* Effect.sleep("10 millis")
      yield* bus.push(id, mkSnapshot(id, 1))
      yield* bus.push(id, mkSnapshot(id, 2))
      const collected = yield* fiber
      const arr = Chunk.toReadonlyArray(collected)
      expect(arr).toHaveLength(2)
      expect(arr[0]!.at).toBe(1)
      expect(arr[1]!.at).toBe(2)
    }).pipe(Effect.provide(TransactionBus.Default), Effect.runPromise))

  it("buses are isolated per editor id", () =>
    Effect.gen(function* () {
      const bus = yield* TransactionBus
      const idA = EditorId("editor-X")
      const idB = EditorId("editor-Y")
      yield* bus.push(idA, mkSnapshot(idA, 7))
      const a = yield* bus.latest(idA)
      const b = yield* bus.latest(idB)
      expect(a!.at).toBe(7)
      expect(b).toBeNull()
    }).pipe(Effect.provide(TransactionBus.Default), Effect.runPromise))

  it("dispose drops the bus entry; latest returns null afterwards", () =>
    Effect.gen(function* () {
      const bus = yield* TransactionBus
      yield* bus.push(id, mkSnapshot(id, 99))
      yield* bus.dispose(id)
      const after = yield* bus.latest(id)
      expect(after).toBeNull()
    }).pipe(Effect.provide(TransactionBus.Default), Effect.runPromise))
})
