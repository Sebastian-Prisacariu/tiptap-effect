import { Schema } from "effect"
import { defineEditorCommand } from "../command.js"

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
    const c = chain.focus() as any
    if (href === null) return c.unsetLink()
    return c.setLink({ href })
  },
  reverseSetup: (state, _input) => {
    const s = state as {
      selection: { from: number; to: number }
      schema: { marks: Record<string, unknown> }
      doc: { rangeHasMark?: any; nodeAt?: any }
    }
    // Read the link mark's current attrs at the active range
    const linkMarkType = (s.schema.marks as { link?: any }).link
    let previousHref: string | null = null
    if (linkMarkType) {
      const $from = (state as any).selection.$from
      const marks = ($from?.marks?.() ?? []) as ReadonlyArray<{
        type: { name: string }
        attrs: { href?: string }
      }>
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
    const c = chain.focus().setTextSelection({ from, to }) as any
    if (previousHref === null) return c.unsetLink()
    return c.setLink({ href: previousHref })
  },
})
