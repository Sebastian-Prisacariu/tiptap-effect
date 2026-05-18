import { screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { renderEditor } from "../helpers/render"

describe("React StrictMode", () => {
  it("does not leave duplicate ProseMirror roots", async () => {
    const view = renderEditor(
      <React.StrictMode>
        <EditorReact.Content data-testid="editor-content" />
      </React.StrictMode>,
    )

    await waitFor(() =>
      expect(screen.getByTestId("editor-content").querySelectorAll(".ProseMirror")).toHaveLength(1)
    )
    expect(view.tracker.mounted).toBeGreaterThanOrEqual(1)
    expect(view.tracker.unmounted).toBeLessThanOrEqual(view.tracker.mounted)

    view.unmount()
    expect(view.tracker.unmounted).toBeGreaterThanOrEqual(view.tracker.mounted)
  })
})
