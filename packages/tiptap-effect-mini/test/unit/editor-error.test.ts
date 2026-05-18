import { describe, expect, it } from "vitest"
import * as EditorError from "../../src/EditorError"

describe("EditorError", () => {
  it("uses tagged data errors", () => {
    const error = new EditorError.OptionsMissing({
      id: "a",
      message: "missing",
    })

    expect(error._tag).toBe("EditorOptionsMissing")
    expect(error.id).toBe("a")
    expect(error.message).toBe("missing")
  })
})

