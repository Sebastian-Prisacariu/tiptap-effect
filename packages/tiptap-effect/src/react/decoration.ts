import { Decoration } from "@tiptap/pm/view"
import type * as React from "react"
import { registerReactPortalEntryForEditorView } from "../editor/internal/react-portal-registry"

type DecorationWidgetOptions = {
  readonly side?: number
  readonly relaxedSide?: boolean
  readonly marks?: readonly unknown[]
  readonly stopEvent?: (event: Event) => boolean
  readonly ignoreSelection?: boolean
  readonly key?: string
  readonly destroy?: (node: Node) => void
}

export interface ReactDecorationSpec<Props extends object = Record<string, never>> {
  readonly Component: React.FC<Props>
  readonly props?: Props
  readonly className?: string
  readonly attrs?: Readonly<Record<string, string>>
  readonly widget: (pos: number, options?: DecorationWidgetOptions) => Decoration
}

/**
 * Creates a typed React decoration descriptor for consumers that want to render
 * decoration views through the same React tree as TiptapView.
 */
export const reactDecoration = <
  Props extends object = Record<string, never>,
>(
  Component: React.FC<Props>,
  options: Omit<ReactDecorationSpec<Props>, "Component" | "widget"> = {},
): ReactDecorationSpec<Props> => ({
  Component,
  ...options,
  widget(pos, widgetOptions = {}) {
    let registration: ReturnType<typeof registerReactPortalEntryForEditorView> | undefined
    return Decoration.widget(
      pos,
      (view) => {
        const dom = document.createElement("span")
        if (options.className) dom.className = options.className
        for (const [name, value] of Object.entries(options.attrs ?? {})) {
          dom.setAttribute(name, value)
        }
        registration = registerReactPortalEntryForEditorView(
          view,
          "decoration",
          (key) => ({
            key,
            kind: "decoration",
            dom,
            contentDOM: null,
            Component: Component as React.FC<Record<string, unknown>>,
            componentProps: (options.props ?? {}) as Record<string, unknown>,
            nodeViewProps: null,
          }),
        )
        return dom
      },
      {
        ...widgetOptions,
        marks: widgetOptions.marks as never,
        destroy(node) {
          registration?.dispose()
          widgetOptions.destroy?.(node)
        },
      },
    )
  },
})
