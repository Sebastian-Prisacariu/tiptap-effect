import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { tiptapAttrsFromSchema } from "../../src/schema/derive"

describe("tiptapAttrsFromSchema", () => {
  it("derives parseHTML/renderHTML for a string field", () => {
    const schema = Schema.Struct({ href: Schema.String })
    const attrs = tiptapAttrsFromSchema(schema)
    expect(attrs).toHaveProperty("href")

    const el = document.createElement("a")
    el.setAttribute("data-href", "https://example.com")
    expect(attrs["href"]!.parseHTML!(el)).toBe("https://example.com")

    expect(attrs["href"]!.renderHTML!({ href: "https://x.com" })).toEqual({
      "data-href": "https://x.com",
    })
  })

  it("derives default from optionalWith({ default })", () => {
    const schema = Schema.Struct({
      level: Schema.Literal(1, 2, 3).pipe(
        Schema.optionalWith({ default: () => 1 as const }),
      ),
    })
    const attrs = tiptapAttrsFromSchema(schema)
    expect(attrs["level"]!.default).toBe(1)
  })

  it("encodes complex types as JSON in renderHTML", () => {
    const schema = Schema.Struct({ meta: Schema.Struct({ a: Schema.Number }) })
    const attrs = tiptapAttrsFromSchema(schema)
    expect(attrs["meta"]!.renderHTML!({ meta: { a: 5 } })).toEqual({
      "data-meta": JSON.stringify({ a: 5 }),
    })
  })

  it("decodes complex types as JSON in parseHTML", () => {
    const schema = Schema.Struct({ meta: Schema.Struct({ a: Schema.Number }) })
    const attrs = tiptapAttrsFromSchema(schema)
    const el = document.createElement("div")
    el.setAttribute("data-meta", JSON.stringify({ a: 5 }))
    expect(attrs["meta"]!.parseHTML!(el)).toEqual({ a: 5 })
  })

  it("handles number fields", () => {
    const schema = Schema.Struct({ count: Schema.Number })
    const attrs = tiptapAttrsFromSchema(schema)
    const el = document.createElement("div")
    el.setAttribute("data-count", "42")
    expect(attrs["count"]!.parseHTML!(el)).toBe(42)
  })

  it("returns undefined when attribute is missing", () => {
    const schema = Schema.Struct({ href: Schema.String })
    const attrs = tiptapAttrsFromSchema(schema)
    const el = document.createElement("a")
    expect(attrs["href"]!.parseHTML!(el)).toBeUndefined()
  })

  it("renderHTML returns {} when value is undefined", () => {
    const schema = Schema.Struct({ href: Schema.String })
    const attrs = tiptapAttrsFromSchema(schema)
    expect(attrs["href"]!.renderHTML!({})).toEqual({})
  })

  it("throws if given a non-Struct schema", () => {
    expect(() => tiptapAttrsFromSchema(Schema.String as never)).toThrow(
      /expected a Schema.Struct/,
    )
  })
})
