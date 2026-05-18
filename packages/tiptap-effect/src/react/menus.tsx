import { Result, useAtomValue } from "@effect-atom/atom-react"
import {
  BubbleMenuPlugin,
  type BubbleMenuPluginProps,
} from "@tiptap/extension-bubble-menu"
import {
  FloatingMenuPlugin,
  type FloatingMenuPluginProps,
} from "@tiptap/extension-floating-menu"
import { PluginKey, type Plugin } from "@tiptap/pm/state"
import * as React from "react"
import { createPortal } from "react-dom"
import { useEditorScope } from "./EditorScope"
import {
  removeMenuEventListeners,
  syncMenuElementProps,
  type EventListenerEntry,
  type MenuElementProps,
} from "./menu-element-props"

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>

export type BubbleMenuProps =
  & Omit<Optional<BubbleMenuPluginProps, "pluginKey">, "editor" | "element">
  & { readonly editor?: MenuEditor | null }
  & MenuElementProps

export type FloatingMenuProps =
  & Omit<Optional<FloatingMenuPluginProps, "pluginKey">, "editor" | "element">
  & {
    readonly editor?: MenuEditor | null
    readonly updateDelay?: number
    readonly resizeDelay?: number
  }
  & MenuElementProps

type MenuPluginInput = Record<string, unknown> & {
  readonly editor: MenuEditor
  readonly element: HTMLDivElement
  readonly pluginKey: PluginKey | string
}
type CreatePlugin = (props: MenuPluginInput) => Plugin
type MenuEditor = {
  readonly isDestroyed: boolean
  readonly state: {
    readonly tr: {
      setMeta(pluginKey: PluginKey | string, value: unknown): unknown
    }
  }
  readonly view: {
    dispatch(transaction: unknown): void
  }
  registerPlugin(plugin: Plugin): void
  unregisterPlugin(pluginKey: PluginKey | string): void
}

type ScopedMenuProps = {
  readonly defaultPluginName: string
  readonly editor?: MenuEditor | null
  readonly pluginKey?: PluginKey | string
  readonly pluginProps: Record<string, unknown>
  readonly htmlProps: MenuElementProps
  readonly children?: React.ReactNode
  readonly ref: React.ForwardedRef<HTMLDivElement>
  readonly createPlugin: CreatePlugin
  readonly updateDeps: React.DependencyList
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

const getAutoPluginKey = (
  pluginKey: PluginKey | string | undefined,
  defaultName: string,
) => pluginKey ?? new PluginKey(defaultName)

const useMenuElement = () => {
  const elementRef = React.useRef<HTMLDivElement | null>(null)
  if (elementRef.current === null && typeof document !== "undefined") {
    elementRef.current = document.createElement("div")
  }
  return elementRef.current
}

const useSyncedElementProps = (
  element: HTMLDivElement | null,
  props: MenuElementProps,
) => {
  const previousPropsRef = React.useRef<MenuElementProps>({})
  const listenersRef = React.useRef<ReadonlyArray<EventListenerEntry>>([])

  useIsomorphicLayoutEffect(() => {
    if (!element) return

    listenersRef.current = syncMenuElementProps(
      element,
      previousPropsRef.current,
      props,
      listenersRef.current,
    )
    previousPropsRef.current = props

    return () => {
      removeMenuEventListeners(element, listenersRef.current)
      listenersRef.current = []
    }
  }, [element, props])
}

const useScopedEditor = () => {
  const { atom } = useEditorScope()
  const result = useAtomValue(atom)
  return Result.isSuccess(result) ? result.value._internal.editor : null
}

const MenuWithEditor = ({
  defaultPluginName,
  editor,
  pluginKey,
  pluginProps,
  htmlProps,
  children,
  ref,
  createPlugin,
  updateDeps,
}: ScopedMenuProps & { readonly editor: MenuEditor | null }) => {
  const element = useMenuElement()
  const resolvedPluginKey = React.useRef(getAutoPluginKey(pluginKey, defaultPluginName)).current
  const pluginPropsRef = React.useRef({
    ...pluginProps,
    pluginKey: resolvedPluginKey,
  })
  const [pluginInitialized, setPluginInitialized] = React.useState(false)
  const skipFirstUpdateRef = React.useRef(true)

  pluginPropsRef.current = {
    ...pluginProps,
    pluginKey: resolvedPluginKey,
  }

  useSyncedElementProps(element, htmlProps)

  React.useImperativeHandle(ref, () => element as HTMLDivElement, [element])

  React.useEffect(() => {
    if (!element || !editor || editor.isDestroyed) return

    element.style.visibility = "hidden"
    element.style.position = "absolute"

    const plugin = createPlugin({
      ...pluginPropsRef.current,
      editor,
      element,
    })

    editor.registerPlugin(plugin)
    skipFirstUpdateRef.current = true
    setPluginInitialized(true)

    return () => {
      setPluginInitialized(false)
      editor.unregisterPlugin(resolvedPluginKey)
      window.requestAnimationFrame(() => {
        if (element.parentNode) element.parentNode.removeChild(element)
      })
    }
  }, [createPlugin, editor, element, resolvedPluginKey])

  React.useEffect(() => {
    if (!pluginInitialized || !editor || editor.isDestroyed) return

    if (skipFirstUpdateRef.current) {
      skipFirstUpdateRef.current = false
      return
    }

    editor.view.dispatch(
      editor.state.tr.setMeta(resolvedPluginKey, {
        type: "updateOptions",
        options: pluginPropsRef.current,
      }),
    )
  }, [editor, pluginInitialized, resolvedPluginKey, ...updateDeps])

  return element ? createPortal(children, element) : null
}

const ScopedMenuFromContext = (props: ScopedMenuProps) => {
  const editor = useScopedEditor()
  return <MenuWithEditor {...props} editor={editor} />
}

const ScopedMenu = (props: ScopedMenuProps) =>
  props.editor === undefined
    ? <ScopedMenuFromContext {...props} />
    : <MenuWithEditor {...props} editor={props.editor} />

export const BubbleMenu = React.forwardRef<HTMLDivElement, BubbleMenuProps>(
  (
    {
      pluginKey,
      editor,
      updateDelay,
      resizeDelay,
      appendTo,
      shouldShow = null,
      getReferencedVirtualElement,
      options,
      children,
      ...htmlProps
    },
    ref,
  ) => (
    <ScopedMenu
      defaultPluginName="bubbleMenu"
      editor={editor}
      pluginKey={pluginKey}
      pluginProps={{
        updateDelay,
        resizeDelay,
        appendTo,
        shouldShow,
        getReferencedVirtualElement,
        options,
      }}
      htmlProps={htmlProps}
      ref={ref}
      createPlugin={(props) => {
        const pluginProps: BubbleMenuPluginProps = {
          ...props,
          editor: props.editor as never,
          element: props.element,
          pluginKey: props.pluginKey,
        }
        return BubbleMenuPlugin(pluginProps)
      }}
      updateDeps={[
        updateDelay,
        resizeDelay,
        appendTo,
        shouldShow,
        getReferencedVirtualElement,
        options,
      ]}
    >
      {children}
    </ScopedMenu>
  ),
)

BubbleMenu.displayName = "BubbleMenu"

export const FloatingMenu = React.forwardRef<HTMLDivElement, FloatingMenuProps>(
  (
    {
      pluginKey,
      editor,
      updateDelay,
      resizeDelay,
      appendTo,
      shouldShow = null,
      options,
      children,
      ...htmlProps
    },
    ref,
  ) => (
    <ScopedMenu
      defaultPluginName="floatingMenu"
      editor={editor}
      pluginKey={pluginKey}
      pluginProps={{
        updateDelay,
        resizeDelay,
        appendTo,
        shouldShow,
        options,
      }}
      htmlProps={htmlProps}
      ref={ref}
      createPlugin={(props) => {
        const pluginProps: FloatingMenuPluginProps = {
          ...props,
          editor: props.editor as never,
          element: props.element,
          pluginKey: props.pluginKey,
        }
        return FloatingMenuPlugin(pluginProps)
      }}
      updateDeps={[
        updateDelay,
        resizeDelay,
        appendTo,
        shouldShow,
        options,
      ]}
    >
      {children}
    </ScopedMenu>
  ),
)

FloatingMenu.displayName = "FloatingMenu"
