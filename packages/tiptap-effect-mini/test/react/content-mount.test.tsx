import { screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { mountContent, renderEditor } from "../helpers/render"

describe("EditorReact.Content", () => {
  it("mounts Tiptap DOM into the container and unmounts it", async () => {
    const view = mountContent()

    const container = screen.getByTestId("editor-content")
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull())
    expect(view.tracker.mounted).toBeGreaterThanOrEqual(1)

    view.unmount()
    expect(view.tracker.unmounted).toBeGreaterThanOrEqual(1)
  })

  it("forwards object and callback refs", () => {
    const objectRef = React.createRef<HTMLDivElement>()
    const callbackRef = vi.fn()
    const Combined = () => (
      <EditorReact.Content
        data-testid="editor-content"
        ref={(node) => {
          objectRef.current = node
          callbackRef(node)
        }}
      />
    )

    const view = renderEditor(<Combined />)
    expect(objectRef.current).toBe(screen.getByTestId("editor-content"))
    expect(callbackRef).toHaveBeenCalledWith(screen.getByTestId("editor-content"))

    view.unmount()
    expect(objectRef.current).toBeNull()
    expect(callbackRef).toHaveBeenCalledWith(null)
  })
})
