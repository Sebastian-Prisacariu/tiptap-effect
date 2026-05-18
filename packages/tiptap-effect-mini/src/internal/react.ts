import * as React from "react"

/**
 * Keeps an internal ref and a forwarded React ref pointed at the same node.
 *
 * Components like `EditorReact.Content` need their own ref so they can mount
 * Tiptap, but consumers should still be able to pass `ref` and receive the
 * underlying DOM element. React supports both callback refs and object refs,
 * so this hook handles both forms and returns one callback ref to attach to
 * the element.
 */
export const useMergedRef = <Element extends HTMLElement>(
  forwardedRef: React.ForwardedRef<Element>,
): readonly [
  ref: React.RefObject<Element | null>,
  setRef: React.RefCallback<Element>,
] => {
  const localRef = React.useRef<Element | null>(null)
  const setRef = React.useCallback((node: Element | null) => {
    localRef.current = node
    if (typeof forwardedRef === "function") {
      forwardedRef(node)
    } else if (forwardedRef) {
      forwardedRef.current = node
    }
  }, [forwardedRef])

  return [localRef, setRef] as const
}

