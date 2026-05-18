import type * as React from "react"

type MenuElementProps = React.HTMLAttributes<HTMLDivElement>
type MenuSyntheticEvent = Event & {
  nativeEvent: Event
  currentTarget: HTMLDivElement
  target: EventTarget | null
  persist: () => void
  isDefaultPrevented: () => boolean
  isPropagationStopped: () => boolean
}
type MenuEventListener = (event: MenuSyntheticEvent) => void
type MenuNativeListener = (event: Event) => void
type MenuEventListenerOptions = {
  readonly capture?: boolean
}

type EventListenerEntry = {
  readonly eventName: string
  readonly listener: MenuNativeListener
  readonly options?: MenuEventListenerOptions
}

const pluginManagedStyleProperties = new Set([
  "left",
  "opacity",
  "position",
  "top",
  "visibility",
  "width",
])

const unitlessStyleProperties = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "columnCount",
  "columns",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
])

const attributeExclusions = new Set(["children", "className", "style"])
const directPropertyKeys = new Set(["tabIndex"])
const forwardedAttributeKeys = new Set([
  "accessKey",
  "autoCapitalize",
  "contentEditable",
  "contextMenu",
  "dir",
  "draggable",
  "enterKeyHint",
  "hidden",
  "id",
  "lang",
  "nonce",
  "role",
  "slot",
  "spellCheck",
  "tabIndex",
  "title",
  "translate",
])

const specialEventNames: Record<string, string> = {
  Blur: "focusout",
  DoubleClick: "dblclick",
  Focus: "focusin",
  MouseEnter: "mouseenter",
  MouseLeave: "mouseleave",
}

const isEventProp = (
  key: string,
  value: unknown,
): value is MenuEventListener =>
  /^on[A-Z]/.test(key) && typeof value === "function"

const isForwardedAttributeKey = (key: string) =>
  key.startsWith("aria-")
  || key.startsWith("data-")
  || forwardedAttributeKeys.has(key)

const toStylePropertyName = (key: string) =>
  key.startsWith("--")
    ? key
    : key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)

const toEventConfig = (key: string) => {
  const useCapture = key.endsWith("Capture")
  const baseKey = useCapture ? key.slice(0, -7) : key
  const reactEventName = baseKey.slice(2)
  const eventName = specialEventNames[reactEventName] ?? reactEventName.toLowerCase()

  return {
    eventName,
    options: useCapture ? { capture: true } : undefined,
  }
}

const createSyntheticEvent = (
  element: HTMLDivElement,
  nativeEvent: Event,
): MenuSyntheticEvent => {
  let defaultPrevented = nativeEvent.defaultPrevented
  let propagationStopped = false
  const syntheticEvent = Object.create(nativeEvent)

  Object.defineProperties(syntheticEvent, {
    nativeEvent: { value: nativeEvent },
    currentTarget: { value: element },
    target: { value: nativeEvent.target },
    persist: { value: () => undefined },
    isDefaultPrevented: { value: () => defaultPrevented },
    isPropagationStopped: { value: () => propagationStopped },
    preventDefault: {
      value: () => {
        defaultPrevented = true
        nativeEvent.preventDefault()
      },
    },
    stopPropagation: {
      value: () => {
        propagationStopped = true
        nativeEvent.stopPropagation()
      },
    },
  })

  return syntheticEvent as MenuSyntheticEvent
}

const setDirectProperty = (
  element: HTMLDivElement,
  key: string,
  value: unknown,
) => {
  if (key === "tabIndex") {
    element.tabIndex = Number(value)
  }
}

const clearDirectProperty = (element: HTMLDivElement, key: string) => {
  if (key === "tabIndex") {
    element.removeAttribute("tabindex")
  }
}

const toStyleValue = (styleName: string, value: string | number) => {
  if (
    typeof value !== "number"
    || value === 0
    || styleName.startsWith("--")
    || unitlessStyleProperties.has(styleName)
  ) {
    return String(value)
  }

  return `${value}px`
}

const removeStyleProperty = (element: HTMLDivElement, styleName: string) => {
  if (pluginManagedStyleProperties.has(styleName)) return
  element.style.removeProperty(toStylePropertyName(styleName))
}

const applyStyleProperty = (
  element: HTMLDivElement,
  styleName: string,
  value: string | number,
) => {
  if (pluginManagedStyleProperties.has(styleName)) return
  element.style.setProperty(toStylePropertyName(styleName), toStyleValue(styleName, value))
}

const syncClassName = (
  element: HTMLDivElement,
  prevClassName?: string,
  nextClassName?: string,
) => {
  if (prevClassName === nextClassName) return
  if (nextClassName) {
    element.className = nextClassName
    return
  }
  element.removeAttribute("class")
}

const syncStyles = (
  element: HTMLDivElement,
  prevStyle: React.CSSProperties | undefined,
  nextStyle: React.CSSProperties | undefined,
) => {
  const previousStyle = prevStyle ?? {}
  const currentStyle = nextStyle ?? {}
  const allStyleNames = new Set([...Object.keys(previousStyle), ...Object.keys(currentStyle)])

  allStyleNames.forEach((styleName) => {
    const prevValue = previousStyle[styleName as keyof React.CSSProperties]
    const nextValue = currentStyle[styleName as keyof React.CSSProperties]

    if (prevValue === nextValue) return

    if (nextValue == null) {
      removeStyleProperty(element, styleName)
      return
    }

    applyStyleProperty(element, styleName, nextValue as string | number)
  })
}

const syncAttributes = (
  element: HTMLDivElement,
  prevProps: MenuElementProps,
  nextProps: MenuElementProps,
) => {
  const allKeys = new Set([...Object.keys(prevProps), ...Object.keys(nextProps)])

  allKeys.forEach((key) => {
    if (
      attributeExclusions.has(key)
      || !isForwardedAttributeKey(key)
      || isEventProp(key, prevProps[key as keyof MenuElementProps])
      || isEventProp(key, nextProps[key as keyof MenuElementProps])
    ) {
      return
    }

    const prevValue = prevProps[key as keyof MenuElementProps]
    const nextValue = nextProps[key as keyof MenuElementProps]

    if (prevValue === nextValue) return

    if (nextValue == null || nextValue === false) {
      if (directPropertyKeys.has(key)) clearDirectProperty(element, key)
      element.removeAttribute(key)
      return
    }

    if (nextValue === true) {
      if (directPropertyKeys.has(key)) setDirectProperty(element, key, true)
      element.setAttribute(key, "")
      return
    }

    if (directPropertyKeys.has(key)) {
      setDirectProperty(element, key, nextValue)
      return
    }

    element.setAttribute(key, String(nextValue))
  })
}

const syncEventListeners = (
  element: HTMLDivElement,
  prevListeners: ReadonlyArray<EventListenerEntry>,
  nextProps: MenuElementProps,
) => {
  prevListeners.forEach(({ eventName, listener, options }) => {
    element.removeEventListener(eventName, listener, options)
  })

  const nextListeners: Array<EventListenerEntry> = []

  Object.entries(nextProps).forEach(([key, value]) => {
    if (!isEventProp(key, value)) return

    const { eventName, options } = toEventConfig(key)
    const listener: MenuNativeListener = (event) => {
      value(createSyntheticEvent(element, event))
    }

    element.addEventListener(eventName, listener, options)
    nextListeners.push({ eventName, listener, options })
  })

  return nextListeners
}

export const syncMenuElementProps = (
  element: HTMLDivElement,
  previousProps: MenuElementProps,
  nextProps: MenuElementProps,
  previousListeners: ReadonlyArray<EventListenerEntry>,
) => {
  syncClassName(element, previousProps.className, nextProps.className)
  syncStyles(element, previousProps.style, nextProps.style)
  syncAttributes(element, previousProps, nextProps)
  return syncEventListeners(element, previousListeners, nextProps)
}

export const removeMenuEventListeners = (
  element: HTMLDivElement,
  listeners: ReadonlyArray<EventListenerEntry>,
) => {
  listeners.forEach(({ eventName, listener, options }) => {
    element.removeEventListener(eventName, listener, options)
  })
}

export type { EventListenerEntry, MenuElementProps }
