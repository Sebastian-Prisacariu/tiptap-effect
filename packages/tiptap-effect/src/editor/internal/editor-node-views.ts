import type { Extensions } from "@tiptap/core"
import type { EditorSchema } from "../../schema/define"
import { NodeViewStore } from "./node-view-store"
import type { EditorSchemaMarks, EditorSchemaNodes } from "./types"

interface TiptapNode {
  readonly type: { readonly name: string }
  readonly attrs: Record<string, unknown>
  readonly isLeaf: boolean
}

interface TiptapNodeViewInput {
  readonly node: TiptapNode
  readonly getPos: () => number | undefined
  readonly view: unknown
  readonly decorations: unknown
}

type NodeViewDefinition = {
  readonly reactNodeView?: React.FC<Record<string, unknown>>
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
          const reactMount = document.createElement("div")
          dom.appendChild(reactMount)
          const contentDOM = node.isLeaf ? null : document.createElement("div")
          if (contentDOM) dom.appendChild(contentDOM)
          const key = nodeViewStore.nextKey()
          let selected = false
          let currentNode: TiptapNode = node

          const writeProps = () => {
            nodeViewStore.update(key, {
              nodeAttrs: currentNode.attrs,
              nodeType: currentNode.type.name,
              getPos,
              selected,
              unsafeNode: currentNode,
            })
          }

          nodeViewStore.add({
            key,
            dom: reactMount,
            contentDOM,
            Component,
            componentProps: {},
            props: {
              nodeAttrs: node.attrs,
              nodeType: node.type.name,
              getPos,
              selected,
              unsafeNode: node,
            },
          })

          return {
            dom,
            contentDOM,
            update(newNode: TiptapNode) {
              if (newNode.type.name !== currentNode.type.name) return false
              currentNode = newNode
              writeProps()
              return true
            },
            selectNode() {
              selected = true
              writeProps()
            },
            deselectNode() {
              selected = false
              writeProps()
            },
            ignoreMutation(mutation: { readonly target?: unknown }) {
              return mutation.target instanceof Node
                && reactMount.contains(mutation.target)
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
