import { Decoration } from "@tiptap/pm/view"
import type * as React from "react"
import {
  addPendingNodeViewEntryForEditorView,
  getNodeViewStoreForEditorView,
  removePendingNodeViewEntryForEditorView,
} from "../editor/internal/node-view-store"

type DecorationWidgetOptions = {
  readonly side?: number
  readonly relaxedSide?: boolean
  readonly marks?: readonly unknown[]
  readonly stopEvent?: (event: Event) => boolean
  readonly ignoreSelection?: boolean
  readonly key?: string
  readonly destroy?: (node: Node) => void
}

let pendingDecorationId = 0

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
    let key: string | undefined
    let mountedStore = null as ReturnType<typeof getNodeViewStoreForEditorView> | null
    let pendingView: object | undefined
    const constructionStore = getNodeViewStoreForEditorView({})
    return Decoration.widget(
      pos,
      (view) => {
        const store = getNodeViewStoreForEditorView(view) ?? constructionStore
        const dom = document.createElement("span")
        if (options.className) dom.className = options.className
        for (const [name, value] of Object.entries(options.attrs ?? {})) {
          dom.setAttribute(name, value)
        }
        key = store?.nextKey("decoration") ?? `decoration-pending-${++pendingDecorationId}`
        mountedStore = store
        const entry = {
          key,
          dom,
          contentDOM: null,
          Component: Component as React.FC<Record<string, unknown>>,
          componentProps: (options.props ?? {}) as Record<string, unknown>,
          props: null,
        }
        if (store) store.add(entry)
        else {
          pendingView = view
          addPendingNodeViewEntryForEditorView(view, entry)
        }
        return dom
      },
      {
        ...widgetOptions,
        marks: widgetOptions.marks as never,
        destroy(node) {
          const store = pendingView
            ? (mountedStore ?? getNodeViewStoreForEditorView(pendingView))
            : mountedStore
          if (key) store?.remove(key)
          if (key && !store && pendingView) {
            removePendingNodeViewEntryForEditorView(pendingView, key)
          }
          widgetOptions.destroy?.(node)
        },
      },
    )
  },
})
