import Bold from "@tiptap/extension-bold"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import type { Extensions } from "@tiptap/core"

export const extensions = (): Extensions => [Document, Paragraph, Text, Bold]
