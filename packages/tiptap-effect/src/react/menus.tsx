import { Result, useAtomValue } from "@effect-atom/atom-react"
import {
  BubbleMenuPlugin,
  type BubbleMenuPluginProps,
} from "@tiptap/extension-bubble-menu"
import {
  FloatingMenuPlugin,
  type FloatingMenuPluginProps,
} from "@tiptap/extension-floating-menu"
import type { Editor } from "@tiptap/core"
import { PluginKey, type Plugin } from "@tiptap/pm/state"
import * as React from "react"
import { createPortal } from "react-dom"
import { useEditorScope } from "./EditorScope"
import { acquireMenuPlugin } from "./internal/menu-plugin-resource"
import { runScopedResourceSync } from "./internal/scoped-resource"

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>
type MenuElementProps = React.HTMLAttributes<HTMLDivElement>

export type BubbleMenuProps =
  & Omit<Optional<BubbleMenuPluginProps, "pluginKey">, "editor" | "element">
  & { readonly editor?: Editor | null }
  & MenuElementProps

export type FloatingMenuProps =
  & Omit<Optional<FloatingMenuPluginProps, "pluginKey">, "editor" | "element">
  & {
    readonly editor?: Editor | null
    readonly updateDelay?: number
    readonly resizeDelay?: number
  }
  & MenuElementProps

type MenuPluginInput = Record<string, unknown> & {
  readonly editor: Editor
  readonly element: HTMLDivElement
  readonly pluginKey: PluginKey | string
}
type CreatePlugin = (props: MenuPluginInput) => Plugin

type ScopedMenuProps = {
  readonly defaultPluginName: string
  readonly editor?: Editor | null
  readonly pluginKey?: PluginKey | string
  readonly pluginProps: Record<string, unknown>
  readonly htmlProps: MenuElementProps
  readonly children?: React.ReactNode
  readonly ref: React.ForwardedRef<HTMLDivElement>
  readonly createPlugin: CreatePlugin
  readonly updateDeps: React.DependencyList
}

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
}: ScopedMenuProps & { readonly editor: Editor | null }) => {
  const element = useMenuElement()
  const resolvedPluginKey = React.useRef(getAutoPluginKey(pluginKey, defaultPluginName)).current
  const pluginPropsRef = React.useRef({
    ...pluginProps,
    pluginKey: resolvedPluginKey,
  })
  const [pluginInitialized, setPluginInitialized] = React.useState(false)
  const skipFirstUpdateRef = React.useRef(true)
  const shellRef = React.useRef<HTMLDivElement | null>(null)

  pluginPropsRef.current = {
    ...pluginProps,
    pluginKey: resolvedPluginKey,
  }

  React.useImperativeHandle(ref, () => shellRef.current as HTMLDivElement)

  React.useEffect(() => {
    if (!element || !editor || editor.isDestroyed) return

    element.style.visibility = "hidden"
    element.style.position = "absolute"

    const plugin = createPlugin({
      ...pluginPropsRef.current,
      editor,
      element,
    })

    const pluginResource = runScopedResourceSync(
      acquireMenuPlugin({
        editor,
        element,
        plugin,
        pluginKey: resolvedPluginKey,
      }),
    )

    skipFirstUpdateRef.current = true
    setPluginInitialized(true)

    let closed = false
    return () => {
      if (closed) return
      closed = true
      setPluginInitialized(false)
      pluginResource.close()
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

  return element
    ? createPortal(
      <div {...htmlProps} ref={shellRef}>
        {children}
      </div>,
      element,
    )
    : null
}

const ScopedMenuFromContext = (props: ScopedMenuProps) => {
  const editor = useScopedEditor()
  return <MenuWithEditor {...props} editor={editor} />
}

const ScopedMenu = (props: ScopedMenuProps) =>
  props.editor === undefined
    ? <ScopedMenuFromContext {...props} />
    : <MenuWithEditor {...props} editor={props.editor} />

const createBubbleMenuPlugin: CreatePlugin = (props) => {
  const pluginProps: BubbleMenuPluginProps = {
    ...props,
    editor: props.editor,
    element: props.element,
    pluginKey: props.pluginKey,
  }
  return BubbleMenuPlugin(pluginProps)
}

const createFloatingMenuPlugin: CreatePlugin = (props) => {
  const pluginProps: FloatingMenuPluginProps = {
    ...props,
    editor: props.editor,
    element: props.element,
    pluginKey: props.pluginKey,
  }
  return FloatingMenuPlugin(pluginProps)
}

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
      createPlugin={createBubbleMenuPlugin}
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
      createPlugin={createFloatingMenuPlugin}
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
