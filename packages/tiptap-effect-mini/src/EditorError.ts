import { Data } from "effect"
import type * as Editor from "./Editor"

/**
 * @category errors
 */
export class OptionsMissing extends Data.TaggedError(
  "EditorOptionsMissing",
)<{
  readonly id: Editor.Id
  readonly message: string
}> {}

