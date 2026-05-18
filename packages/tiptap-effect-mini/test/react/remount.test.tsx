import { act, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { renderEditor } from "../helpers/render"

const ToggleContent = () => {
  const [visible, setVisible] = React.useState(true)
  return (
    <>
      <button type="button" onClick={() => setVisible((_) => !_)}>toggle</button>
      {visible ? <EditorReact.Content data-testid="editor-content" /> : null}
    </>
  )
}

describe("content remounting", () => {
  it("releases and reacquires the DOM mount without replacing the editor", async () => {
    const view = renderEditor(<ToggleContent />)
    expect(view.tracker.created).toBe(1)
    await waitFor(() =>
      expect(screen.getByTestId("editor-content").querySelectorAll(".ProseMirror")).toHaveLength(1)
    )

    act(() => screen.getByText("toggle").click())
    expect(view.tracker.unmounted).toBeGreaterThanOrEqual(1)

    act(() => screen.getByText("toggle").click())
    expect(view.tracker.created).toBe(1)
    await waitFor(() =>
      expect(screen.getByTestId("editor-content").querySelectorAll(".ProseMirror")).toHaveLength(1)
    )
  })
})
