import type * as React from "react"

export interface ReactDecorationSpec<Props extends object = Record<string, never>> {
  readonly Component: React.FC<Props>
  readonly props?: Props
  readonly className?: string
  readonly attrs?: Readonly<Record<string, string>>
}

/**
 * Creates a typed React decoration descriptor for consumers that want to render
 * decoration views through the same React tree as TiptapView.
 */
export const reactDecoration = <
  Props extends object = Record<string, never>,
>(
  Component: React.FC<Props>,
  options: Omit<ReactDecorationSpec<Props>, "Component"> = {},
): ReactDecorationSpec<Props> => ({
  Component,
  ...options,
})
