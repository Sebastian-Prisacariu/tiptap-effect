import { act, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { renderEditor } from "../helpers/render"

const LifecycleProbe = ({ onUpdate }: { readonly onUpdate: () => void }) => {
  const setContent = EditorReact.useSetContent()
  EditorReact.useEvent("update", onUpdate)
  return <button type="button" onClick={() => setContent("<p>Updated</p>")}>update</button>
}

describe("editor lifecycle hooks", () => {
  it("subscribes and unsubscribes event listeners", () => {
    const onUpdate = vi.fn()
    const view = renderEditor(<LifecycleProbe onUpdate={onUpdate} />)

    act(() => screen.getByText("update").click())
    expect(onUpdate).toHaveBeenCalledTimes(1)

    const offBefore = view.tracker.off
    view.unmount()
    expect(view.tracker.off).toBeGreaterThan(offBefore)
  })

  it("useSubscribe observes selected values", async () => {
    const handler = vi.fn()
    const Probe = () => {
      const setContent = EditorReact.useSetContent()
      EditorReact.useSubscribe((snapshot) => snapshot.editor.getText(), handler)
      return <button type="button" onClick={() => setContent("<p>Observed</p>")}>set</button>
    }

    renderEditor(<Probe />)
    act(() => screen.getByText("set").click())
    await waitFor(() => expect(handler).toHaveBeenCalledWith("Observed"))
  })
})
