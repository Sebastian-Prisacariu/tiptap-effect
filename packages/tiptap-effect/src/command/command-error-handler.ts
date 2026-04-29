import { Effect, PubSub } from "effect"
import type { EditorId } from "../types"

/**
 * Event emitted whenever a command fails with a real failure cause.
 * Interruptions are not published.
 */
export interface CommandFailed {
  readonly editorId: EditorId
  readonly op: string
  readonly cause: unknown
  readonly at: number
}

/**
 * Safety-net service for command failures. The default implementation logs the
 * failure and publishes a typed event for React hooks or telemetry wiring.
 */
export class CommandErrorHandler extends Effect.Service<CommandErrorHandler>()(
  "tiptap-effect/CommandErrorHandler",
  {
    effect: Effect.gen(function* () {
      const events = yield* PubSub.unbounded<CommandFailed>()
      const handle = (event: CommandFailed): Effect.Effect<void> =>
        Effect.logError("[tiptap-effect/commands] command failed", {
          editorId: event.editorId,
          op: event.op,
          cause: event.cause,
        }).pipe(
          Effect.zipRight(PubSub.publish(events, event)),
          Effect.asVoid,
        )

      return { events, handle } as const
    }),
  },
) {}

export const CommandErrorHandlerLive = CommandErrorHandler.Default
