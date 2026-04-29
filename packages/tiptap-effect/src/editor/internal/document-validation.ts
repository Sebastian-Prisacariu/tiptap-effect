import { generateHTML, type JSONContent } from "@tiptap/core"
import { Data, Effect, Either, ParseResult, Schema } from "effect"
import type { EditorSchema, NodeJSON } from "../../schema/define"
import type { EditorSchemaMarks, EditorSchemaNodes } from "./types"

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
): Effect.Effect<void> =>
  Effect.try({
    try: () => documentJsonFromState(state),
    catch: (cause) => new DocumentJsonError({ cause }),
  }).pipe(
    Effect.flatMap((json) => {
      const decoded = decodeDocumentJson(schema, json)
      if (Either.isRight(decoded)) return Effect.void

      return Effect.logWarning(
        "[tiptap-effect/devSchemaCheck] editor state document does not match schema.Document",
        { cause: decoded.left },
      )
    }),
    Effect.catchAll((cause) =>
      Effect.logWarning(
        "[tiptap-effect/devSchemaCheck] could not read editor state document",
        { cause },
      ),
    ),
  )
