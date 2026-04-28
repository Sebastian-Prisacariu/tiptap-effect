import { Schema } from "effect"
import { defineEditorCommand } from "../command.js"

type LinkChain<Chain> = Chain & {
  readonly setLink: (attrs: { readonly href: string }) => Chain
  readonly unsetLink: () => Chain
}

type MarkAtSelection = {
  readonly type: { readonly name: string }
  readonly attrs: { readonly href?: string }
}

type LinkState = {
  readonly selection: {
    readonly from: number
    readonly to: number
    readonly $from: { readonly marks?: () => ReadonlyArray<MarkAtSelection> }
  }
  readonly schema: { readonly marks: { readonly link?: unknown } }
}

/**
 * Set or clear a link mark over the current selection. `href: null` removes
 * the link. Wraps `@tiptap/extension-link`'s `setLink` / `unsetLink` chain
 * commands — the consumer must install `@tiptap/extension-link` and add it
 * to the editor's extensions list themselves (we don't peer-depend on it).
 *
 * Reverse: re-applies the prior `href` (captured from `getAttributes("link")`
 * at dispatch time) — or removes the link if none was present.
 */
export const SetLinkCommand = defineEditorCommand({
  op: "tiptap-effect.set-link",
  description: ({ href }) =>
    href === null ? "Remove link" : `Set link → ${href}`,
  inputSchema: Schema.Struct({
    href: Schema.Union(Schema.String, Schema.Null),
  }),
  outputSchema: Schema.Struct({
    previousHref: Schema.Union(Schema.String, Schema.Null),
    from: Schema.Number,
    to: Schema.Number,
  }),
  capturesSelection: true,
  apply: (chain, { href }) => {
    const c = chain.focus() as LinkChain<typeof chain>
    if (href === null) return c.unsetLink()
    return c.setLink({ href })
  },
  reverseSetup: (state, _input) => {
    const s = state as LinkState
    // Read the link mark's current attrs at the active range
    const linkMarkType = s.schema.marks.link
    let previousHref: string | null = null
    if (linkMarkType) {
      const marks = s.selection.$from.marks?.() ?? []
      const link = marks.find((m) => m.type.name === "link")
      previousHref = link?.attrs?.href ?? null
    }
    return {
      previousHref,
      from: s.selection.from,
      to: s.selection.to,
    }
  },
  applyReverse: (chain, _input, { previousHref, from, to }) => {
    const c = chain.focus().setTextSelection({ from, to }) as LinkChain<typeof chain>
    if (previousHref === null) return c.unsetLink()
    return c.setLink({ href: previousHref })
  },
})
