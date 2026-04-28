import { describe, expect, it } from "vitest"
import { PACKAGE_NAME } from "../src/index"

describe("smoke", () => {
  it("package barrel exports a name", () => {
    expect(PACKAGE_NAME).toBe("tiptap-effect")
  })
})
