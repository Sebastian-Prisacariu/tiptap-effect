import { Effect, Scope } from "effect"
import type * as React from "react"
import * as ReactDOMClient from "react-dom/client"

export interface MountedReactRoot {
  readonly render: (children: React.ReactNode) => Effect.Effect<void>
}

export const acquireReactRoot = (
  dom: HTMLElement,
): Effect.Effect<MountedReactRoot, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => ReactDOMClient.createRoot(dom)),
    (root) => Effect.sync(() => root.unmount()),
  ).pipe(
    Effect.map((root) => ({
      render: (children) => Effect.sync(() => root.render(children)),
    })),
  )
