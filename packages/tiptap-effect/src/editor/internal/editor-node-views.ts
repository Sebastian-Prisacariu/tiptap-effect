import type { Extensions } from "@tiptap/core"
import type { EditorSchema } from "../../schema/define"
import { NodeViewStore } from "../../react/internal/node-view-store"
import type { EditorSchemaMarks, EditorSchemaNodes } from "./types"

interface TiptapNodeViewInput {
  readonly node: {
    readonly type: { readonly name: string }
    readonly attrs: Record<string, unknown>
  }
  readonly getPos: () => number | undefined
  readonly view: unknown
  readonly decorations: unknown
}

type NodeViewDefinition = {
  readonly reactNodeView?: React.FC
}

const withReactNodeViews = <
  N extends EditorSchemaNodes,
  M extends EditorSchemaMarks,
>(
  schema: EditorSchema<N, M>,
  extensions: Extensions,
  nodeViewStore: NodeViewStore,
): Extensions =>
  extensions.map((extension) => {
    const name = (extension as { readonly name: string }).name
    const definition = schema.nodes[name] as NodeViewDefinition | undefined
    const Component = definition?.reactNodeView
    if (!Component) return extension

    return extension.extend({
      addNodeView() {
        return ({ node, getPos }: TiptapNodeViewInput) => {
          const dom = document.createElement("div")
          const key = nodeViewStore.nextKey()

          nodeViewStore.add({
            key,
            dom,
            contentDOM: null,
            Component,
            props: {
              nodeAttrs: node.attrs,
              nodeType: node.type.name,
              getPos,
              selected: false,
            },
          })

          return {
            dom,
            contentDOM: null,
            update(newNode: TiptapNodeViewInput["node"]) {
              nodeViewStore.update(key, {
                nodeAttrs: newNode.attrs,
                nodeType: newNode.type.name,
                getPos,
                selected: false,
              })
              return true
            },
            destroy() {
              nodeViewStore.remove(key)
            },
          }
        }
      },
    })
  })

export { withReactNodeViews }
