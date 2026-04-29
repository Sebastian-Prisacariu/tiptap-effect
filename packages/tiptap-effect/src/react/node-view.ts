import type * as React from "react"

/**
 * Marks a React component as a schema NodeView component.
 */
export const reactNodeView = <Props extends object = Record<string, never>>(
  Component: React.FC<Props>,
): React.FC<Props> => Component
