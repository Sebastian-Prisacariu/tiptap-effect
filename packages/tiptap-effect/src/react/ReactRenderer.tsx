import * as React from "react"
import * as ReactDOMClient from "react-dom/client"
import { flushSync } from "react-dom"

export interface ReactRendererOptions<P extends object = object> {
  readonly editor: unknown
  readonly props?: P
  readonly as?: keyof HTMLElementTagNameMap
  readonly className?: string
}

export class ReactRenderer<
  R = unknown,
  P extends object = object,
> {
  readonly id = Math.floor(Math.random() * 4294967295).toString()
  readonly editor: unknown
  readonly component: React.ElementType
  readonly element: HTMLElement
  ref: R | null = null
  props: P
  destroyed = false
  private readonly root: ReactDOMClient.Root

  constructor(
    component: React.ElementType,
    options: ReactRendererOptions<P>,
  ) {
    this.component = component
    this.editor = options.editor
    this.props = (options.props ?? {}) as P
    this.element = document.createElement(options.as ?? "div")
    this.element.classList.add("react-renderer")
    if (options.className) this.element.classList.add(...options.className.split(" "))
    this.root = ReactDOMClient.createRoot(this.element)
    this.render()
  }

  render(): void {
    if (this.destroyed) return
    const Component = this.component as React.ComponentType<P & { ref?: React.Ref<R> }>
    const props = {
      ...this.props,
      ref: (ref: R | null) => {
        this.ref = ref
      },
    }

    flushSync(() => {
      this.root.render(<Component {...props} />)
    })
  }

  updateProps(props: Partial<P> = {}): void {
    if (this.destroyed) return
    this.props = { ...this.props, ...props }
    this.render()
  }

  updateAttributes(attributes: Record<string, string>): void {
    Object.entries(attributes).forEach(([key, value]) => {
      this.element.setAttribute(key, value)
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    flushSync(() => {
      this.root.unmount()
    })
    this.element.parentNode?.removeChild(this.element)
  }
}
