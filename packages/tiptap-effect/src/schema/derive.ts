import { Either, Schema, SchemaAST } from "effect"

export interface TiptapAttributeSpec {
  readonly default?: unknown
  readonly parseHTML?: (element: HTMLElement) => unknown
  readonly renderHTML?: (
    attributes: Record<string, unknown>,
  ) => Record<string, unknown>
  readonly keepOnSplit?: boolean
}

const isPrimitiveAST = (ast: SchemaAST.AST): boolean =>
  SchemaAST.isStringKeyword(ast)
  || SchemaAST.isNumberKeyword(ast)
  || SchemaAST.isBooleanKeyword(ast)
  || SchemaAST.isLiteral(ast)

const stringifyAttr = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

const parseAttr = (raw: string, ast: SchemaAST.AST): unknown => {
  if (SchemaAST.isStringKeyword(ast)) return raw
  if (SchemaAST.isNumberKeyword(ast)) {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  if (SchemaAST.isBooleanKeyword(ast)) return raw === "true"
  if (SchemaAST.isLiteral(ast)) {
    const lit = ast.literal
    if (typeof lit === "string") return raw
    if (typeof lit === "number") return Number(raw)
    if (typeof lit === "boolean") return raw === "true"
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const drillToInner = (ast: SchemaAST.AST): SchemaAST.AST => {
  let current = ast
  while (true) {
    if (SchemaAST.isRefinement(current)) {
      current = current.from
      continue
    }
    if (SchemaAST.isTransformation(current)) {
      current = current.to
      continue
    }
    if (SchemaAST.isUnion(current)) {
      const nonUndef = current.types.find(
        (t: SchemaAST.AST) => !SchemaAST.isUndefinedKeyword(t),
      )
      if (nonUndef) {
        current = nonUndef
        continue
      }
    }
    return current
  }
}

/**
 * Derive Tiptap's `addAttributes` shape from a `Schema.Struct` of attrs.
 *
 * For each named field:
 *   - `default` is taken from the field's optional-with-default annotation,
 *     when present.
 *   - `parseHTML` reads the value from `data-<fieldName>` and decodes it.
 *   - `renderHTML` writes the value to `data-<fieldName>`, encoded.
 *
 * Primitive fields (string/number/boolean/literal) are stored as plain
 * strings; complex fields are JSON-encoded.
 */
export const tiptapAttrsFromSchema = <Fields extends Schema.Struct.Fields>(
  schema: Schema.Struct<Fields>,
): Record<string, TiptapAttributeSpec> => {
  // optionalWith({ default }) applied to fields wraps the Struct's AST in a
  // Transformation. Drill through to reach the underlying TypeLiteral.
  let ast: SchemaAST.AST = schema.ast
  while (SchemaAST.isTransformation(ast)) {
    ast = ast.from
  }
  if (!SchemaAST.isTypeLiteral(ast)) {
    throw new Error(
      `tiptapAttrsFromSchema: expected a Schema.Struct, got ${ast._tag}`,
    )
  }

  const result: Record<string, TiptapAttributeSpec> = {}

  // Probe the decoder with `{}` to harvest default-populated values for fields
  // declared via `Schema.optionalWith({ default })`. If the schema has required
  // fields without defaults, the probe fails — defaults are simply not extracted
  // for those fields. Tiptap then leaves the attribute as undefined when missing.
  const probed = Schema.decodeUnknownEither(
    schema as unknown as Schema.Schema<unknown, unknown>,
  )({})
  const defaults: Record<string, unknown> = Either.isRight(probed)
    ? (probed.right as Record<string, unknown>)
    : {}

  for (const prop of ast.propertySignatures) {
    const key = String(prop.name)
    const innerAST = drillToInner(prop.type)
    const dataAttr = `data-${key}`

    const defaultValue = defaults[key]

    result[key] = {
      default: defaultValue,
      parseHTML: (element: HTMLElement) => {
        const raw = element.getAttribute(dataAttr)
        if (raw === null) return undefined
        if (isPrimitiveAST(innerAST)) return parseAttr(raw, innerAST)
        try {
          return JSON.parse(raw)
        } catch {
          return raw
        }
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[key]
        if (value === undefined || value === null) return {}
        return { [dataAttr]: stringifyAttr(value) }
      },
    }
  }

  return result
}
