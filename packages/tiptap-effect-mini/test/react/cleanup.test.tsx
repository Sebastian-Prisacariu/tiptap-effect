import { act, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { renderEditor } from "../helpers/render"

const ToggleProvider = () => {
  const [visible, setVisible] = React.useState(true)
  return (
    <>
      <button type="button" onClick={() => setVisible((_) => !_)}>toggle</button>
      {visible ? <EditorReact.Content data-testid="editor-content" /> : null}
    </>
  )
}

describe("cleanup behavior", () => {
  it("does not leave mounted DOM or listeners after repeated toggles", async () => {
    const view = renderEditor(<ToggleProvider />)

    for (let i = 0; i < 4; i++) {
      act(() => screen.getByText("toggle").click())
      expect(screen.queryByTestId("editor-content")).toBeNull()
      act(() => screen.getByText("toggle").click())
      await waitFor(() =>
        expect(screen.getByTestId("editor-content").querySelectorAll(".ProseMirror")).toHaveLength(1)
      )
    }

    view.unmount()
    await waitFor(() => expect(view.tracker.off).toBeGreaterThan(0))
    expect(view.tracker.unmounted).toBeGreaterThanOrEqual(view.tracker.mounted)
  })
})
