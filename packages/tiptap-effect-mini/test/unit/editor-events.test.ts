import { Editor } from "@tiptap/core"
import { describe, expect, it, vi } from "vitest"
import * as EditorDomain from "../../src/Editor"
import * as internal from "../../src/internal/editor"
import { editorOptions } from "../helpers/extensions"

describe("Editor events", () => {
  it("exports the expected event domains", () => {
    expect(EditorDomain.eventNames).toContain("transaction")
    expect(EditorDomain.eventNames).toContain("selectionUpdate")
    expect(EditorDomain.eventNames).toContain("destroy")
    expect(EditorDomain.defaultRefreshEvents).toEqual([
      "transaction",
      "selectionUpdate",
      "update",
      "focus",
      "blur",
    ])
  })

  it("attaches and removes typed Tiptap listeners", () => {
    const editor = new Editor({ ...editorOptions(), element: null })
    const listener = vi.fn()

    internal.onEvent(editor, "transaction", listener)
    editor.emit("transaction", {
      editor,
      transaction: editor.state.tr,
      appendedTransactions: [],
    })
    expect(listener).toHaveBeenCalledTimes(1)

    internal.offEvent(editor, "transaction", listener)
    editor.emit("transaction", {
      editor,
      transaction: editor.state.tr,
      appendedTransactions: [],
    })
    expect(listener).toHaveBeenCalledTimes(1)

    editor.destroy()
  })
})

