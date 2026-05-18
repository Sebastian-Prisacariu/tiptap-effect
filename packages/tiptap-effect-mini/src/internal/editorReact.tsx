'use client'

import {
  useAtomInitialValues,
  useAtomMount,
  useAtomSet,
  useAtomSubscribe,
  useAtomValue,
} from "@effect-atom/atom-react"
import type {
  EditorEvents as NativeEditorEvents,
  JSONContent,
  SetContentOptions,
} from "@tiptap/core"
import type { Effect } from "effect"
import * as React from "react"
import type * as Editor from "../Editor"
import * as EditorAtom from "../EditorAtom"
import * as editorEvent from "./editor"
import { useMergedRef } from "./react"
import { useIsomorphicLayoutEffect } from "../utils/useIsomorphicLayoutEffect"

const Context = React.createContext<Editor.Id | null>(null)

const useStableId = (id?: Editor.Id): Editor.Id => {
  const reactId = React.useId()
  return id ?? `mini-${reactId}`
}

export const Provider = ({
  id,
  options,
  children,
}: {
  readonly id?: Editor.Id
  readonly options: Editor.Options
  readonly children: React.ReactNode
}) => {
  const editorId = useStableId(id)
  useAtomInitialValues([[EditorAtom.options(editorId), options]])

  const setOptions = useAtomSet(EditorAtom.setOptions)
  const previousOptions = React.useRef(options)

  React.useEffect(() => {
    if (previousOptions.current === options) return
    previousOptions.current = options
    setOptions({ id: editorId, options })
  }, [editorId, options, setOptions])

  return (
    <Context.Provider value={editorId}>
      {children}
    </Context.Provider>
  )
}

export const useId = (): Editor.Id => {
  const id = React.useContext(Context)
  if (id === null) {
    throw new Error(
      "tiptap-effect-mini: hook must be used inside <EditorReact.Provider>",
    )
  }
  return id
}

export const useSnapshot = (): Editor.Snapshot | null =>
  useAtomValue(EditorAtom.snapshot(useId()))

export const useEditor = (): Editor.Editor | null =>
  useAtomValue(EditorAtom.instance(useId()))

export const Content = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function Content(props, forwardedRef) {
  const id = useId()
  const setMountElement = useAtomSet(EditorAtom.mountElement(id))
  const [localRef, setRef] = useMergedRef(forwardedRef)

  useAtomMount(EditorAtom.events(id))
  useAtomMount(EditorAtom.mounted(id))

  useIsomorphicLayoutEffect(() => {
    setMountElement(localRef.current)
    return () => setMountElement(null)
  }, [setMountElement])

  return <div {...props} ref={setRef} />
})

export function useState<T>(
  options: Editor.StateOptions<T>,
): T | null {
  const id = useId()
  const selectorAtom = React.useMemo(
    () => EditorAtom.slice(id, options.selector),
    [id, options.selector],
  )
  const value = useAtomValue(selectorAtom)
  const previous = React.useRef<T | null>(null)
  const equalityFn = options.equalityFn ?? Object.is

  if (value === null) {
    previous.current = null
    return null
  }
  if (previous.current !== null && equalityFn(previous.current, value)) {
    return previous.current
  }
  previous.current = value
  return value
}

export const useSubscribe = <T,>(
  selector: (snapshot: Editor.Snapshot) => T,
  handler: (value: T) => void,
): void => {
  const id = useId()
  const selectorAtom = React.useMemo(
    () => EditorAtom.slice(id, selector),
    [id, selector],
  )
  useAtomSubscribe(selectorAtom, (value) => {
    if (value !== null) handler(value)
  })
}

export const useEvent = <Event extends Editor.Event>(
  event: Event,
  handler: (payload: NativeEditorEvents[Event]) => void,
): void => {
  const editor = useEditor()
  React.useEffect(() => {
    if (!editor) return
    const listener = (...payload: editorEvent.EventArgs<Event>) => {
      handler(payload[0])
    }
    editorEvent.onEvent(editor, event, listener)
    return () => editorEvent.offEvent(editor, event, listener)
  }, [editor, event, handler])
}

export const useJSON = (): JSONContent | null =>
  useAtomValue(EditorAtom.json(useId()))

export const useHTML = (): string | null =>
  useAtomValue(EditorAtom.html(useId()))

export const useText = (): string | null =>
  useAtomValue(EditorAtom.text(useId()))

export const useIsFocused = (): boolean =>
  useAtomValue(EditorAtom.isFocused(useId()))

export const useEditable = (): readonly [
  editable: boolean,
  setEditable: (editable: boolean) => void,
] => {
  const id = useId()
  const atom = React.useMemo(() => EditorAtom.isEditable(id), [id])
  return [useAtomValue(atom), useAtomSet(atom)] as const
}

export const useIsEditable = (): boolean =>
  useAtomValue(EditorAtom.isEditable(useId()))

export const useSetEditable = (): ((editable: boolean, emitUpdate?: boolean) => void) => {
  const id = useId()
  const setEditable = useAtomSet(EditorAtom.setEditable)
  return React.useCallback(
    (editable, emitUpdate) => setEditable({ id, editable, emitUpdate }),
    [id, setEditable],
  )
}

export const useIsActive = (
  name: string,
  attributes?: Record<string, unknown>,
): boolean => {
  const id = useId()
  return useAtomValue(
    React.useMemo(
      () => EditorAtom.isActive(id, name, attributes),
      [id, name, attributes],
    ),
  )
}

export const useCanRun = (
  command: (editor: Editor.Editor) => boolean,
): boolean => {
  const id = useId()
  return useAtomValue(
    React.useMemo(() => EditorAtom.canRun(id, command), [id, command]),
  )
}

export const useSetContent = (): ((
  content: string | JSONContent,
  options?: SetContentOptions,
) => void) => {
  const id = useId()
  const setContent = useAtomSet(EditorAtom.setContent)
  return React.useCallback(
    (content, options) => setContent({ id, content, options }),
    [id, setContent],
  )
}

export const useRun = <A,>(): ((
  run: (editor: Editor.Editor) => A,
  options?: {
    readonly refresh?: ReadonlyArray<Editor.RefreshKind>
  },
) => void) => {
  const id = useId()
  const runEditor = useAtomSet(EditorAtom.runSync)
  return React.useCallback(
    (run, options) => runEditor({ id, run, refresh: options?.refresh }),
    [id, runEditor],
  )
}

export const useRunEffect = <A,>(): ((
  run: (editor: Editor.Editor) => Effect.Effect<A, unknown, never>,
  options?: {
    readonly refresh?: ReadonlyArray<Editor.RefreshKind>
  },
) => void) => {
  const id = useId()
  const runEditor = useAtomSet(EditorAtom.run)
  return React.useCallback(
    (run, options) => runEditor({ id, run, refresh: options?.refresh }),
    [id, runEditor],
  )
}

export const useRefresh = (): (() => void) => {
  const id = useId()
  const refresh = useAtomSet(EditorAtom.refresh)
  return React.useCallback(() => refresh(id), [id, refresh])
}

export const useLifecycle = (
  handler: (snapshot: Editor.Snapshot) => void,
  events: ReadonlyArray<Editor.Event> = editorEvent.defaultRefreshEvents,
): void => {
  const editor = useEditor()
  const snapshot = useSnapshot()
  const handlerRef = React.useRef(handler)
  const snapshotRef = React.useRef(snapshot)

  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  React.useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  React.useEffect(() => {
    if (!editor) return
    const listener = () => {
      const current = snapshotRef.current
      if (current !== null) handlerRef.current(current)
    }
    for (const event of events) editorEvent.onEvent(editor, event, listener)
    return () => {
      for (const event of events) editorEvent.offEvent(editor, event, listener)
    }
  }, [editor, events])
}
