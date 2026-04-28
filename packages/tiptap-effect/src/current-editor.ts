import type { Editor as TiptapEditor } from "@tiptap/core"
import { Context } from "effect"

/**
 * Effect Context tag for the editor a Command runs against.
 * The CommandExecutor provides this when invoking forward/reverse.
 */
export class CurrentEditor extends Context.Tag("tiptap-effect/CurrentEditor")<
  CurrentEditor,
  TiptapEditor
>() {}
