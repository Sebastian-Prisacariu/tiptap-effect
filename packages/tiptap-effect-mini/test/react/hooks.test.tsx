import { act, screen, waitFor } from "@testing-library/react"
import { Effect } from "effect"
import * as React from "react"
import { describe, expect, it } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { renderEditor } from "../helpers/render"

const HooksProbe = () => {
  const text = EditorReact.useText()
  const html = EditorReact.useHTML()
  const json = EditorReact.useJSON()
  const [editable, setEditable] = EditorReact.useEditable()
  const setContent = EditorReact.useSetContent()
  const run = EditorReact.useRun()
  const runEffect = EditorReact.useRunEffect()

  return (
    <>
      <div data-testid="text">{text}</div>
      <div data-testid="html">{html}</div>
      <div data-testid="json">{json?.type}</div>
      <div data-testid="editable">{String(editable)}</div>
      <button type="button" onClick={() => setContent("<p>Set</p>")}>set</button>
      <button type="button" onClick={() => setEditable(false)}>editable</button>
      <button type="button" onClick={() => run((editor) => editor.commands.setContent("<p>Run</p>"), { refresh: ["document"] })}>run</button>
      <button type="button" onClick={() => runEffect((editor) => Effect.sync(() => editor.commands.setContent("<p>Effect</p>")), { refresh: ["document"] })}>effect</button>
    </>
  )
}

describe("EditorReact hooks", () => {
  it("reads and mutates editor state", async () => {
    renderEditor(<HooksProbe />)

    expect(screen.getByTestId("text")).toHaveTextContent("Hello")
    expect(screen.getByTestId("html")).toHaveTextContent("<p>Hello</p>")
    expect(screen.getByTestId("json")).toHaveTextContent("doc")

    act(() => screen.getByText("set").click())
    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("Set"))

    act(() => screen.getByText("editable").click())
    await waitFor(() => expect(screen.getByTestId("editable")).toHaveTextContent("false"))

    act(() => screen.getByText("run").click())
    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("Run"))

    act(() => screen.getByText("effect").click())
    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("Effect"))
  })
})
