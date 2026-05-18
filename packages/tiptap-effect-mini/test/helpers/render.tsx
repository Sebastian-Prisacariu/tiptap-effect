import { RegistryContext } from "@effect-atom/atom-react"
import { render } from "@testing-library/react"
import * as React from "react"
import * as Editor from "../../src/Editor"
import * as EditorAtom from "../../src/EditorAtom"
import * as EditorReact from "../../src/EditorReact"
import { editorOptions } from "./extensions"
import { makeEditorRegistry } from "./registry"

export const renderEditor = (
  children: React.ReactNode,
  options: Editor.Options = editorOptions(),
  id: Editor.Id = "editor",
) => {
  const ctx = makeEditorRegistry(id, options)
  const view = render(
    <RegistryContext.Provider value={ctx.registry}>
      <EditorReact.Provider id={id} options={options}>
        {children}
      </EditorReact.Provider>
    </RegistryContext.Provider>,
  )
  return { ...ctx, ...view }
}

export const mountContent = (
  options: Editor.Options = editorOptions(),
  id: Editor.Id = "editor",
) => renderEditor(<EditorReact.Content data-testid="editor-content" />, options, id)

