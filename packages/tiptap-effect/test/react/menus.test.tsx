import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Editor } from "@tiptap/core"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BubbleMenu, FloatingMenu } from "tiptap-effect/react/menus"

const menuMocks = vi.hoisted(() => ({
  bubblePluginProps: [] as Array<Record<string, unknown>>,
  floatingPluginProps: [] as Array<Record<string, unknown>>,
}))

vi.mock("@tiptap/extension-bubble-menu", () => ({
  BubbleMenuPlugin: vi.fn((props: Record<string, unknown>) => {
    menuMocks.bubblePluginProps.push(props)
    document.body.appendChild(props.element as HTMLDivElement)
    return { key: props.pluginKey }
  }),
}))

vi.mock("@tiptap/extension-floating-menu", () => ({
  FloatingMenuPlugin: vi.fn((props: Record<string, unknown>) => {
    menuMocks.floatingPluginProps.push(props)
    document.body.appendChild(props.element as HTMLDivElement)
    return { key: props.pluginKey }
  }),
}))

const makeEditor = () => {
  const setMeta = vi.fn((pluginKey: unknown, value: unknown) => ({
    pluginKey,
    value,
  }))

  return {
    isDestroyed: false,
    state: {
      tr: { setMeta },
    },
    view: {
      dispatch: vi.fn(),
    },
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
    setMeta,
  } as unknown as Editor & {
    readonly setMeta: typeof setMeta
    readonly view: Editor["view"] & { readonly dispatch: ReturnType<typeof vi.fn> }
    readonly registerPlugin: ReturnType<typeof vi.fn>
    readonly unregisterPlugin: ReturnType<typeof vi.fn>
  }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
  menuMocks.bubblePluginProps.length = 0
  menuMocks.floatingPluginProps.length = 0
})

describe("React menus", () => {
  it("renders BubbleMenu root props on a React shell inside the plugin host", async () => {
    const editor = makeEditor()
    const ref = React.createRef<HTMLDivElement>()
    let clickCurrentTarget: EventTarget | null = null
    let clickNativeEvent: Event | null = null
    const onClick = vi.fn((event: React.MouseEvent<HTMLDivElement>) => {
      clickCurrentTarget = event.currentTarget
      clickNativeEvent = event.nativeEvent
    })

    render(
      <BubbleMenu
        editor={editor}
        pluginKey="bubble"
        ref={ref}
        className="menu-shell"
        data-testid="bubble-menu"
        data-menu-kind="text"
        aria-label="Text actions"
        onClick={onClick}
      >
        <button type="button">Bold</button>
      </BubbleMenu>,
    )

    const shell = await screen.findByTestId("bubble-menu")
    const host = menuMocks.bubblePluginProps[0]?.element as HTMLDivElement

    expect(host).toBeInstanceOf(HTMLDivElement)
    expect(shell.parentElement).toBe(host)
    expect(shell.classList.contains("menu-shell")).toBe(true)
    expect(shell.getAttribute("data-menu-kind")).toBe("text")
    expect(shell.getAttribute("aria-label")).toBe("Text actions")
    expect(host.classList.contains("menu-shell")).toBe(false)
    expect(host.style.position).toBe("absolute")
    expect(host.style.visibility).toBe("hidden")
    expect(ref.current).toBe(shell)

    fireEvent.click(shell)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(clickCurrentTarget).toBe(shell)
    expect(clickNativeEvent).toBeInstanceOf(Event)
  })

  it("updates BubbleMenu plugin options without recreating root event adapters", async () => {
    const editor = makeEditor()

    const { rerender } = render(
      <BubbleMenu editor={editor} pluginKey="bubble" updateDelay={50}>
        Menu
      </BubbleMenu>,
    )

    await waitFor(() => {
      expect(editor.registerPlugin).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await Promise.resolve()
    })

    rerender(
      <BubbleMenu editor={editor} pluginKey="bubble" updateDelay={100}>
        Menu
      </BubbleMenu>,
    )

    await waitFor(() => {
      expect(editor.view.dispatch).toHaveBeenCalledTimes(1)
    })

    expect(editor.setMeta).toHaveBeenCalledWith("bubble", {
      type: "updateOptions",
      options: expect.objectContaining({ updateDelay: 100 }),
    })
  })

  it("does not unregister a menu plugin after the editor is already destroyed", async () => {
    const editor = makeEditor()

    const rendered = render(
      <BubbleMenu editor={editor} pluginKey="bubble">
        Menu
      </BubbleMenu>,
    )

    await waitFor(() => {
      expect(editor.registerPlugin).toHaveBeenCalledTimes(1)
    })

    Object.assign(editor, { isDestroyed: true })

    rendered.unmount()

    expect(editor.unregisterPlugin).not.toHaveBeenCalled()
  })

  it("renders FloatingMenu children through the same React shell", async () => {
    const editor = makeEditor()

    render(
      <FloatingMenu
        editor={editor}
        pluginKey="floating"
        className="floating-shell"
        data-testid="floating-menu"
      >
        <button type="button">Paragraph</button>
      </FloatingMenu>,
    )

    const shell = await screen.findByTestId("floating-menu")
    const host = menuMocks.floatingPluginProps[0]?.element as HTMLDivElement

    expect(shell.parentElement).toBe(host)
    expect(shell.classList.contains("floating-shell")).toBe(true)
    expect(shell.textContent).toContain("Paragraph")
  })
})
