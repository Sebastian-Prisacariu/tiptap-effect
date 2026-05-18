import { act, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { editorOptions } from "../helpers/extensions"
import { renderEditor } from "../helpers/render"

const RebuildProbe = () => {
  const [content, setContent] = React.useState("<p>One</p>")
  return (
    <>
      <button type="button" onClick={() => setContent("<p>Two</p>")}>rebuild</button>
      <EditorReact.Provider id="rebuild" options={editorOptions(content)}>
        <EditorReact.Content data-testid="editor-content" />
        <RebuildText />
      </EditorReact.Provider>
    </>
  )
}

const RebuildText = () => <div data-testid="text">{EditorReact.useText()}</div>

describe("option rebuilds", () => {
  it("destroys old editor and creates a new one when options change", async () => {
    const view = renderEditor(<RebuildProbe />, editorOptions("<p>ignored</p>"), "outer")

    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("One"))
    act(() => screen.getByText("rebuild").click())

    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("Two"))
    expect(view.tracker.created).toBeGreaterThanOrEqual(2)
    expect(view.tracker.destroyed).toBeGreaterThanOrEqual(1)
  })
})
