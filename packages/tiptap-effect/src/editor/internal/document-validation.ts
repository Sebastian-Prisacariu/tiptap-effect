import { generateHTML, type JSONContent } from "@tiptap/core"
import { Data, Effect, Either, ParseResult, Schema } from "effect"
import type { EditorSchema, NodeJSON } from "../../schema/define"
import type { EditorSchemaMarks, EditorSchemaNodes, SchemaMismatchPolicy } from "./types"

interface StateWithDocument {
  readonly doc: {
    readonly toJSON: () => unknown
  }
}

export type DecodedDocument<
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
> = Schema.Schema.Type<EditorSchema<N, M>["Document"]>

export class DocumentJsonError extends Data.TaggedError("DocumentJsonError")<{
  readonly cause: unknown
}> {}

export class DocumentHtmlError extends Data.TaggedError("DocumentHtmlError")<{
  readonly cause: unknown
}> {}

export const documentJsonFromState = (state: unknown): unknown =>
  (state as StateWithDocument).doc.toJSON()

export const decodeDocumentJson = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  json: unknown,
): Either.Either<DecodedDocument<N, M>, ParseResult.ParseError> =>
  Schema.decodeUnknownEither(schema.Document)(json)

export const decodeDocumentFromState = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  state: unknown,
): Either.Either<
  DecodedDocument<N, M>,
  ParseResult.ParseError | DocumentJsonError
> => {
  const json = Effect.runSync(
    Effect.try({
      try: () => documentJsonFromState(state),
      catch: (cause) => new DocumentJsonError({ cause }),
    }).pipe(Effect.either),
  )

  if (Either.isLeft(json)) return Either.left(json.left)
  return decodeDocumentJson(schema, json.right)
}

export const documentHtmlFromState = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  state: unknown,
): Either.Either<
  string,
  ParseResult.ParseError | DocumentJsonError | DocumentHtmlError
> => {
  const decoded = decodeDocumentFromState(schema, state)
  if (Either.isLeft(decoded)) return decoded

  return Effect.runSync(
    Effect.try({
      try: () =>
        generateHTML(
          decoded.right as NodeJSON as JSONContent,
          schema.tiptapExtensions,
        ),
      catch: (cause) => new DocumentHtmlError({ cause }),
    }).pipe(Effect.either),
  )
}

export const checkDocumentSchema = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  state: unknown,
  policy: SchemaMismatchPolicy = "log",
): Effect.Effect<void, ParseResult.ParseError | DocumentJsonError> => {
  if (policy === "ignore") return Effect.void

  const onError = (
    cause: ParseResult.ParseError | DocumentJsonError,
    message: string,
  ) =>
    policy === "throw"
      ? Effect.fail(cause)
      : Effect.logWarning(message, { cause })

  return Effect.try({
    try: () => documentJsonFromState(state),
    catch: (cause) => new DocumentJsonError({ cause }),
  }).pipe(
    Effect.flatMap((json) => {
      const decoded = decodeDocumentJson(schema, json)
      if (Either.isRight(decoded)) return Effect.void

      return onError(
        decoded.left,
        "[tiptap-effect/onSchemaMismatch] editor state document does not match schema.Document",
      )
    }),
    Effect.catchAll((cause) =>
      onError(
        cause,
        "[tiptap-effect/onSchemaMismatch] could not read editor state document",
      ),
    ),
  )
}
