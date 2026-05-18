import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import * as EditorReact from "../../src/EditorReact"
import { renderEditor } from "../helpers/render"

const Probe = () => {
  const editor = EditorReact.useEditor()
  return <div data-testid="ready">{editor ? "ready" : "missing"}</div>
}

describe("EditorReact.Provider", () => {
  it("provides an editor to descendants", () => {
    renderEditor(<Probe />)
    expect(screen.getByTestId("ready")).toHaveTextContent("ready")
  })

  it("scopes sibling editors by id", () => {
    const A = () => <div data-testid="a">{EditorReact.useText()}</div>
    const B = () => <div data-testid="b">{EditorReact.useText()}</div>

    renderEditor(<A />, undefined, "a")
    renderEditor(<B />, undefined, "b")

    expect(screen.getByTestId("a")).toHaveTextContent("Hello")
    expect(screen.getByTestId("b")).toHaveTextContent("Hello")
  })
})

