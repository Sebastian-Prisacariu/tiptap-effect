import type { Editor as TiptapEditor } from "@tiptap/core"
import { Context } from "effect"
import type { EditorId } from "../../types"

interface EditorContextService {
  readonly id: EditorId
  readonly editor: TiptapEditor
}

export class EditorContext extends Context.Tag("tiptap-effect/EditorContext")<
  EditorContext,
  EditorContextService
>() {}
