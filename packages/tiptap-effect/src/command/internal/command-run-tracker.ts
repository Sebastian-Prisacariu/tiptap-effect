import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Step } from "@tiptap/pm/transform"
import { Effect, Fiber, Ref } from "effect"
import type { CommandErrorHandler } from "../command-error-handler"
import type { CommandValidationError } from "../command"
import type { CurrentEditor } from "./current-editor"
import {
  clearContext,
  installDispatchWrapper,
  replayInversions,
  setContext,
  type TransactionalRollbackError,
} from "./transactional-rollback"
import { commandKey } from "./command-concurrency"
import type { EditorId } from "../../types"

let cmdIdCounter = 0
const nextCmdId = (op: string): string => `${op}-${Date.now()}-${cmdIdCounter++}`

export interface TrackRunInput<A, E, R> {
  readonly editorId: EditorId
  readonly editor: TiptapEditor
  readonly op: string
  readonly transactional: boolean
  readonly trackOp: boolean
  readonly run: Effect.Effect<A, E, R>
}

export const makeCommandRunTracker = Effect.fnUntraced(function* (deps: {
  readonly errorHandler: CommandErrorHandler
}) {
  const transactionalSemaphores = yield* Ref.make<
    ReadonlyMap<EditorId, Effect.Semaphore>
  >(new Map())
  const perOpFibers = yield* Ref.make<
    ReadonlyMap<string, Fiber.RuntimeFiber<unknown, unknown>>
  >(new Map())
  const perEditorFibers = new WeakMap<
    TiptapEditor,
    Set<Fiber.RuntimeFiber<unknown, unknown>>
  >()

  const getOrCreateTransactionalSemaphore = Effect.fnUntraced(function* (
    editorId: EditorId,
  ) {
    const current = yield* Ref.get(transactionalSemaphores)
    const existing = current.get(editorId)
    if (existing) return existing
    const fresh = yield* Effect.makeSemaphore(1)
    return yield* Ref.modify(transactionalSemaphores, (m) => {
      const winner = m.get(editorId) ?? fresh
      if (winner === fresh) {
        const next = new Map(m)
        next.set(editorId, fresh)
        return [fresh, next]
      }
      return [winner, m]
    })
  })

  const interruptExistingOp = Effect.fnUntraced(function* (
    editorId: EditorId,
    op: string,
  ) {
    const key = commandKey(editorId, op)
    const existing = yield* Ref.modify(perOpFibers, (all) => {
      const existing = all.get(key)
      if (!existing) return [undefined, all]
      const next = new Map(all)
      next.delete(key)
      return [existing, next]
    })
    if (existing) yield* Fiber.interrupt(existing)
  })

  const interruptAllForEditor = Effect.fnUntraced(function* (
    editor: TiptapEditor,
  ) {
    const set = perEditorFibers.get(editor)
    if (!set || set.size === 0) return
    const fibers = Array.from(set)
    yield* Effect.forEach(fibers, (f) => Fiber.interruptFork(f), {
      concurrency: "unbounded",
      discard: true,
    })
  })

  const run = <A, E, R>({
    editorId,
    editor,
    op,
    transactional,
    trackOp,
    run,
  }: TrackRunInput<A, E, R>): Effect.Effect<
    A,
    E | TransactionalRollbackError,
    R
  > => {
    const body = Effect.gen(function* () {
      const cmdId = nextCmdId(op)
      const inversions: Array<Step> = []

      if (transactional) {
        yield* installDispatchWrapper(editor)
        setContext(editor, { cmdId, inversions })
      }

      const inner = run.pipe(
        Effect.tapErrorCause((cause) =>
          deps.errorHandler.handle({
            editorId,
            op,
            cause,
            at: Date.now(),
          }),
        ),
      )

      const fiber = yield* Effect.fork(inner)
      let editorSet = perEditorFibers.get(editor)
      if (!editorSet) {
        editorSet = new Set()
        perEditorFibers.set(editor, editorSet)
      }
      const erased: Fiber.RuntimeFiber<unknown, unknown> = fiber
      editorSet.add(erased)
      const key = commandKey(editorId, op)
      if (trackOp) {
        yield* Ref.update(perOpFibers, (all) => {
          const next = new Map(all)
          next.set(key, erased)
          return next
        })
      }

      return yield* Fiber.join(fiber).pipe(
        Effect.tapErrorCause(() =>
          transactional ? replayInversions(editor, inversions) : Effect.void,
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            editorSet!.delete(erased)
            if (editorSet!.size === 0) perEditorFibers.delete(editor)
            if (trackOp) {
              yield* Ref.update(perOpFibers, (all) => {
                if (all.get(key) !== erased) return all
                const next = new Map(all)
                next.delete(key)
                return next
              })
            }
            if (transactional) clearContext(editor, cmdId)
          }),
        ),
      )
    })

    return transactional
      ? Effect.flatMap(getOrCreateTransactionalSemaphore(editorId), (sem) =>
          sem.withPermits(1)(body),
        )
      : body
  }

  return {
    run,
    interruptExistingOp,
    interruptAllForEditor,
  } as const
})

export type CommandRunTracker = Effect.Effect.Success<
  ReturnType<typeof makeCommandRunTracker>
>
