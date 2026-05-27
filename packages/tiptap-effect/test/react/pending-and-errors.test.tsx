import { Registry, Result } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { Effect, Schema } from "effect"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defineCommand, Reverse } from "tiptap-effect/command"
import type { CommandFailed } from "tiptap-effect/command"
import {
  EditorScope,
  TiptapView,
  useCommandErrors,
  useCommandPending,
  type DispatchResult,
  useDispatch,
  useRawEditor,
} from "tiptap-effect/react"
import { defineEditorSchema } from "tiptap-effect/schema"
import { BoldMark } from "tiptap-effect/schema"
import { DocNode, ParagraphNode, TextNode } from "tiptap-effect/schema"
import { createEditor, EditorId } from "tiptap-effect"

const lessonSchema = defineEditorSchema({
  nodes: { doc: DocNode, paragraph: ParagraphNode, text: TextNode },
  marks: { bold: BoldMark },
})

const LessonEditor = createEditor(lessonSchema)

const validDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
}

const SlowOp = defineCommand({
  op: "test.slow.hook",
  description: () => "slow",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({ done: Schema.Boolean }),
  forward: () =>
    Effect.gen(function* () {
      yield* Effect.sleep("80 millis")
      return { done: true }
    }),
  reverse: Reverse.skipOnUndo,
  concurrencyPolicy: "allow-concurrent",
})

const FailingCmd = defineCommand({
  op: "test.failing.hook",
  description: () => "fails",
  inputSchema: Schema.Void,
  outputSchema: Schema.Struct({}),
  forward: () => Effect.fail("boom" as const),
  reverse: Reverse.skipOnUndo,
})

let registry: Registry.Registry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  cleanup()
  registry.dispose()
})

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
)

describe("useCommandPending", () => {
  it("flips true while a same-op Command is in flight, false on completion", async () => {
    let exposed: {
      dispatch: DispatchResult
      pending: boolean
      editor: ReturnType<typeof useRawEditor>
    } | null = null
    const transitions: boolean[] = []

    const Probe: React.FC = () => {
      const dispatch = useDispatch({ mode: "result" })
      const pending = useCommandPending("test.slow.hook")
      const editor = useRawEditor({ unsafe: true })
      transitions.push(pending)
      exposed = { dispatch, pending, editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-pending-1")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposed).not.toBeNull()
      expect(exposed!.editor).not.toBeNull()
    })

    // Initial: pending = false
    expect(exposed!.pending).toBe(false)

    // Kick off a slow dispatch (don't await — we want to observe pending=true)
    let dispatchPromise: Promise<Result.Result<unknown, unknown>> | null = null
    await act(async () => {
      dispatchPromise = exposed!.dispatch(SlowOp, undefined)
      // Yield so the runtime starts the fiber and pendingOps updates
      await new Promise((r) => setTimeout(r, 10))
    })

    // pending should now be true
    expect(transitions.includes(true)).toBe(true)

    // Wait for completion
    await act(async () => {
      await dispatchPromise!
    })

    // pending should now be false
    expect(exposed!.pending).toBe(false)
  })

  it("is scoped to the current EditorScope", async () => {
    let exposedA: {
      dispatch: DispatchResult
      pending: boolean
      editor: ReturnType<typeof useRawEditor>
    } | null = null
    let exposedB: {
      pending: boolean
      editor: ReturnType<typeof useRawEditor>
    } | null = null
    const transitionsA: boolean[] = []
    const transitionsB: boolean[] = []

    const ProbeA: React.FC = () => {
      const dispatch = useDispatch({ mode: "result" })
      const pending = useCommandPending("test.slow.hook")
      const editor = useRawEditor({ unsafe: true })
      transitionsA.push(pending)
      exposedA = { dispatch, pending, editor }
      return null
    }
    const ProbeB: React.FC = () => {
      const pending = useCommandPending("test.slow.hook")
      const editor = useRawEditor({ unsafe: true })
      transitionsB.push(pending)
      exposedB = { pending, editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-pending-a")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <ProbeA />
        </EditorScope>
        <EditorScope
          id={EditorId("ed-pending-b")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <ProbeB />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedA?.editor).not.toBeNull()
      expect(exposedB?.editor).not.toBeNull()
    })

    let dispatchPromise: Promise<Result.Result<unknown, unknown>> | null = null
    await act(async () => {
      dispatchPromise = exposedA!.dispatch(SlowOp, undefined)
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(transitionsA.includes(true)).toBe(true)
    expect(transitionsB.includes(true)).toBe(false)

    await act(async () => {
      await dispatchPromise!
    })
  })
})

describe("useCommandErrors", () => {
  it("invokes the handler on every CommandFailed event", async () => {
    const events: CommandFailed[] = []

    let exposed: {
      dispatch: DispatchResult
      editor: ReturnType<typeof useRawEditor>
    } | null = null

    const Probe: React.FC = () => {
      const dispatch = useDispatch({ mode: "result" })
      const editor = useRawEditor({ unsafe: true })
      useCommandErrors((event) => {
        events.push(event)
      })
      exposed = { dispatch, editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-errors-1")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <Probe />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposed).not.toBeNull()
      expect(exposed!.editor).not.toBeNull()
    })

    // Yield long enough for useEffect's PubSub subscription to be fully
    // established BEFORE we publish events. effect-atom schedules the atom's
    // effect asynchronously, so the registry.subscribe() call only KICKS OFF
    // the subscription — we need a tick or two for Stream.fromPubSub to
    // actually take a permit on the underlying queue.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // Dispatch a failing cmd; the executor should publish a CommandFailed event
    let result: Result.Result<unknown, unknown> | null = null
    await act(async () => {
      result = await exposed!.dispatch(FailingCmd, undefined)
      expect(Result.isFailure(result)).toBe(true)
      // Yield to let the Stream.runForEach pipeline call the handler
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0]!.op).toBe("test.failing.hook")
  })

  it("is scoped to the current EditorScope", async () => {
    const eventsA: CommandFailed[] = []
    const eventsB: CommandFailed[] = []
    let exposedA: {
      dispatch: DispatchResult
      editor: ReturnType<typeof useRawEditor>
    } | null = null
    let exposedB: {
      editor: ReturnType<typeof useRawEditor>
    } | null = null

    const ProbeA: React.FC = () => {
      const dispatch = useDispatch({ mode: "result" })
      const editor = useRawEditor({ unsafe: true })
      useCommandErrors((event) => {
        eventsA.push(event)
      })
      exposedA = { dispatch, editor }
      return null
    }
    const ProbeB: React.FC = () => {
      const editor = useRawEditor({ unsafe: true })
      useCommandErrors((event) => {
        eventsB.push(event)
      })
      exposedB = { editor }
      return null
    }

    render(
      <Wrapper>
        <EditorScope
          id={EditorId("ed-errors-a")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <ProbeA />
        </EditorScope>
        <EditorScope
          id={EditorId("ed-errors-b")}
          editor={LessonEditor}
          spec={{
            defaultContent: validDoc,
          }}
        >
          <TiptapView />
          <ProbeB />
        </EditorScope>
      </Wrapper>,
    )

    await waitFor(() => {
      expect(exposedA?.editor).not.toBeNull()
      expect(exposedB?.editor).not.toBeNull()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
      const result = await exposedA!.dispatch(FailingCmd, undefined)
      expect(Result.isFailure(result)).toBe(true)
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(eventsA.length).toBeGreaterThanOrEqual(1)
    expect(eventsA[0]!.op).toBe("test.failing.hook")
    expect(eventsB).toHaveLength(0)
  })
})
