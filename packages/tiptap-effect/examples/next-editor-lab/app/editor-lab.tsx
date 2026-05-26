"use client"

import { Registry, Result } from "@effect-atom/atom"
import { RegistryContext } from "@effect-atom/atom-react"
import {
  Activity,
  Bold,
  BookOpen,
  Check,
  ChevronDown,
  ClipboardCheck,
  Code2,
  FileJson,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  History,
  Image,
  Italic,
  ListChecks,
  PanelRight,
  Plus,
  Quote,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  UserRound,
} from "lucide-react"
import { Effect, Schema } from "effect"
import * as React from "react"
import {
  Commands,
  EditorId,
  EditorScope,
  type EditorSpec,
  Marks,
  Nodes,
  TiptapView,
  canExecuteAtom,
  defineEditorCommand,
  defineEditorSchema,
  docAtom,
  generateHTML,
  hasSelectionAtom,
  htmlAtom,
  isActiveAtom,
  plainTextAtom,
  reactNodeView,
  selectedTextAtom,
  selectionAtom,
  useCommandErrors,
  useCommandPending,
  useDispatch,
  useDispatchPromise,
  useEditorSlice,
  useHistory,
  useNodeViewProps,
} from "tiptap-effect"
import { BubbleMenu, FloatingMenu } from "tiptap-effect/react/menus"
import { NodeViewWrapper } from "tiptap-effect/react"
import type { NodeDefinition } from "tiptap-effect/schema"

type Tone = "info" | "success" | "warning" | "danger"
type ReviewState = "draft" | "review" | "approved"

interface CalloutAttrs extends Record<string, unknown> {
  id: string
  tone: Tone
  title: string
  body: string
}

interface TaskAttrs extends Record<string, unknown> {
  id: string
  title: string
  owner: string
  state: ReviewState
  due: string
}

interface QuizAttrs extends Record<string, unknown> {
  id: string
  prompt: string
  options: string
  correct: number
}

interface MediaAttrs extends Record<string, unknown> {
  id: string
  kind: "video" | "image" | "embed"
  title: string
  source: string
  caption: string
}

interface MentionAttrs extends Record<string, unknown> {
  id: string
  label: string
  role: string
}

const id = () => Math.random().toString(36).slice(2, 10)

const nextTone = (tone: Tone): Tone =>
  tone === "info" ? "success" : tone === "success" ? "warning" : tone === "warning" ? "danger" : "info"

const nextState = (state: ReviewState): ReviewState =>
  state === "draft" ? "review" : state === "review" ? "approved" : "draft"

const run = <A, E,>(effect: Effect.Effect<A, E>) => {
  Effect.runPromise(effect).catch((error) => console.error(error))
}

const CalloutView = reactNodeView(() => {
  const dispatch = useDispatch()
  const { attrs, getPos, selected } = useNodeViewProps<CalloutAttrs>()

  const updateTone = () => {
    const pos = getPos()
    if (pos === undefined) return
    run(dispatch(Commands.UpdateNodeAttrsCommand, {
      pos,
      attrs: { tone: nextTone(attrs.tone) },
    }))
  }

  return (
    <NodeViewWrapper className={`node-card callout tone-${attrs.tone}`} data-selected={selected}>
      <div className="node-card-header">
        <span className="node-chip">{attrs.tone}</span>
        <button type="button" className="icon-button ghost" onClick={updateTone} aria-label="Cycle tone">
          <Highlighter size={16} />
        </button>
      </div>
      <strong>{attrs.title}</strong>
      <p>{attrs.body}</p>
    </NodeViewWrapper>
  )
})

const TaskView = reactNodeView(() => {
  const dispatch = useDispatch()
  const { attrs, getPos, selected } = useNodeViewProps<TaskAttrs>()

  const updateState = () => {
    const pos = getPos()
    if (pos === undefined) return
    run(dispatch(Commands.UpdateNodeAttrsCommand, {
      pos,
      attrs: { state: nextState(attrs.state) },
    }))
  }

  return (
    <NodeViewWrapper className="node-card task-card" data-selected={selected}>
      <div className="node-card-header">
        <span className={`status-pill state-${attrs.state}`}>{attrs.state}</span>
        <button type="button" className="icon-button ghost" onClick={updateState} aria-label="Advance task">
          <Check size={16} />
        </button>
      </div>
      <strong>{attrs.title}</strong>
      <div className="node-meta">
        <span>{attrs.owner}</span>
        <span>{attrs.due}</span>
      </div>
    </NodeViewWrapper>
  )
})

const QuizView = reactNodeView(() => {
  const { attrs, selected } = useNodeViewProps<QuizAttrs>()
  const options = attrs.options.split("|")

  return (
    <NodeViewWrapper className="node-card quiz-card" data-selected={selected}>
      <div className="node-card-header">
        <span className="node-chip">knowledge check</span>
        <ListChecks size={16} />
      </div>
      <strong>{attrs.prompt}</strong>
      <div className="quiz-options">
        {options.map((option, index) => (
          <span key={option} data-correct={index === attrs.correct}>
            {option}
          </span>
        ))}
      </div>
    </NodeViewWrapper>
  )
})

const MediaView = reactNodeView(() => {
  const { attrs, selected } = useNodeViewProps<MediaAttrs>()

  return (
    <NodeViewWrapper className="node-card media-card" data-selected={selected}>
      <div className="media-thumb" data-kind={attrs.kind}>
        {attrs.kind === "video" ? <Sparkles size={30} /> : attrs.kind === "image" ? <Image size={30} /> : <Code2 size={30} />}
      </div>
      <div>
        <span className="node-chip">{attrs.kind}</span>
        <strong>{attrs.title}</strong>
        <p>{attrs.caption}</p>
        <small>{attrs.source}</small>
      </div>
    </NodeViewWrapper>
  )
})

const MentionView = reactNodeView(() => {
  const { attrs, selected } = useNodeViewProps<MentionAttrs>()

  return (
    <NodeViewWrapper as="span" className="mention-chip" data-selected={selected}>
      @{attrs.label}
      <span>{attrs.role}</span>
    </NodeViewWrapper>
  )
})

const CalloutNode: NodeDefinition<"calloutBlock", CalloutAttrs> = {
  name: "calloutBlock",
  attrsSchema: Schema.Struct({
    id: Schema.String,
    tone: Schema.Literal("info", "success", "warning", "danger"),
    title: Schema.String,
    body: Schema.String,
  }) as NodeDefinition<"calloutBlock", CalloutAttrs>["attrsSchema"],
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: "section[data-callout-block]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", { ...HTMLAttributes, "data-callout-block": "" }],
  reactNodeView: CalloutView,
}

const TaskNode: NodeDefinition<"taskBlock", TaskAttrs> = {
  name: "taskBlock",
  attrsSchema: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    owner: Schema.String,
    state: Schema.Literal("draft", "review", "approved"),
    due: Schema.String,
  }) as NodeDefinition<"taskBlock", TaskAttrs>["attrsSchema"],
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: "section[data-task-block]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", { ...HTMLAttributes, "data-task-block": "" }],
  reactNodeView: TaskView,
}

const QuizNode: NodeDefinition<"quizBlock", QuizAttrs> = {
  name: "quizBlock",
  attrsSchema: Schema.Struct({
    id: Schema.String,
    prompt: Schema.String,
    options: Schema.String,
    correct: Schema.Number,
  }) as NodeDefinition<"quizBlock", QuizAttrs>["attrsSchema"],
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: "section[data-quiz-block]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", { ...HTMLAttributes, "data-quiz-block": "" }],
  reactNodeView: QuizView,
}

const MediaNode: NodeDefinition<"mediaBlock", MediaAttrs> = {
  name: "mediaBlock",
  attrsSchema: Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("video", "image", "embed"),
    title: Schema.String,
    source: Schema.String,
    caption: Schema.String,
  }) as NodeDefinition<"mediaBlock", MediaAttrs>["attrsSchema"],
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: "figure[data-media-block]" }],
  renderHTML: ({ HTMLAttributes }) => ["figure", { ...HTMLAttributes, "data-media-block": "" }],
  reactNodeView: MediaView,
}

const MentionNode: NodeDefinition<"mention", MentionAttrs> = {
  name: "mention",
  attrsSchema: Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    role: Schema.String,
  }) as NodeDefinition<"mention", MentionAttrs>["attrsSchema"],
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "span[data-mention]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", { ...HTMLAttributes, "data-mention": "" }],
  reactNodeView: MentionView,
}

const courseSchema = defineEditorSchema({
  nodes: {
    doc: Nodes.DocNode,
    paragraph: Nodes.ParagraphNode,
    heading: Nodes.HeadingNode,
    text: Nodes.TextNode,
    calloutBlock: CalloutNode,
    taskBlock: TaskNode,
    quizBlock: QuizNode,
    mediaBlock: MediaNode,
    mention: MentionNode,
  },
  marks: {
    bold: Marks.BoldMark,
    italic: Marks.ItalicMark,
  },
})

const initialContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Leadership onboarding: decision quality" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "This section mixes learning copy, review tasks, inline collaborators, and rich blocks. " },
        { type: "mention", attrs: { id: "mentor", label: "Maja", role: "mentor" } },
        { type: "text", text: " owns the final learning check." },
      ],
    },
    {
      type: "calloutBlock",
      attrs: {
        id: "callout-1",
        tone: "info",
        title: "Facilitator note",
        body: "Ask learners to name the signal they would trust before they choose an action.",
      },
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Scenario setup" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A regional manager sees lagging completion data and asks for a short intervention. The learner must distinguish symptoms from causes before making the change." },
      ],
    },
    {
      type: "mediaBlock",
      attrs: {
        id: "media-1",
        kind: "video",
        title: "Three-minute case video",
        source: "frontcore://media/decision-quality-case",
        caption: "Use this as the first embedded asset in the module.",
      },
    },
    {
      type: "taskBlock",
      attrs: {
        id: "task-1",
        title: "Review tone and evidence level before publishing",
        owner: "Sebastian",
        state: "review",
        due: "Today",
      },
    },
    {
      type: "quizBlock",
      attrs: {
        id: "quiz-1",
        prompt: "What should the manager verify first?",
        options: "Completion trend|Root cause hypothesis|Course thumbnail|Calendar color",
        correct: 1,
      },
    },
  ],
} as const

const editorId = EditorId("next-editor-lab")

const InsertAtSelectionCommand = defineEditorCommand({
  op: "lab.insert-at-selection",
  description: () => "Insert content at selection",
  inputSchema: Schema.Struct({ content: Schema.Unknown }),
  outputSchema: Schema.Struct({ previousContent: Schema.Unknown }),
  capturesSelection: true,
  reverseSetup: (state) => ({ previousContent: state.doc.toJSON() }),
  apply: (chain, { content }) => chain.focus().insertContent(content as never),
  applyReverse: (chain, _input, { previousContent }) => chain.setContent(previousContent as never),
})

const blockFactories = {
  callout: () => ({
    type: "calloutBlock",
    attrs: {
      id: id(),
      tone: "warning",
      title: "Risk to clarify",
      body: "Replace this with the concrete misconception or compliance concern.",
    },
  }),
  task: () => ({
    type: "taskBlock",
    attrs: {
      id: id(),
      title: "Check localization and assessment wording",
      owner: "Course team",
      state: "draft",
      due: "Friday",
    },
  }),
  quiz: () => ({
    type: "quizBlock",
    attrs: {
      id: id(),
      prompt: "Which signal is most reliable?",
      options: "Anecdote|Observed behavior|Preferred layout|Launch date",
      correct: 1,
    },
  }),
  media: () => ({
    type: "mediaBlock",
    attrs: {
      id: id(),
      kind: "embed",
      title: "External leadership canvas",
      source: "https://example.com/embed/leadership-canvas",
      caption: "Pre-approved embed placeholder for consent and layout testing.",
    },
  }),
  mention: () => ({
    type: "mention",
    attrs: {
      id: id(),
      label: "Alex",
      role: "reviewer",
    },
  }),
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="toolbar-button"
      data-active={active}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

function FormatToolbar() {
  const dispatch = useDispatch()
  const history = useHistory()
  const boldActive = useEditorSlice((scopeId) => isActiveAtom(scopeId, "bold"))
  const italicActive = useEditorSlice((scopeId) => isActiveAtom(scopeId, "italic"))
  const canBold = useEditorSlice((scopeId) => canExecuteAtom(scopeId, Commands.ToggleMarkCommand("bold"), undefined))
  const insertPending = useCommandPending(InsertAtSelectionCommand.op)

  const insert = (kind: keyof typeof blockFactories) =>
    run(dispatch(InsertAtSelectionCommand, { content: blockFactories[kind]() }))

  return (
    <div className="toolbar" aria-label="Editor toolbar">
      <div className="toolbar-group">
        <ToolbarButton label="Bold" active={boldActive} disabled={!canBold} onClick={() => run(dispatch(Commands.ToggleMarkCommand("bold"), undefined))}>
          <Bold size={17} />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={italicActive} onClick={() => run(dispatch(Commands.ToggleMarkCommand("italic"), undefined))}>
          <Italic size={17} />
        </ToolbarButton>
      </div>
      <div className="toolbar-group">
        <ToolbarButton label="Heading 1" onClick={() => run(dispatch(Commands.SetHeadingCommand, { level: 1 }))}>
          <Heading1 size={18} />
        </ToolbarButton>
        <ToolbarButton label="Heading 2" onClick={() => run(dispatch(Commands.SetHeadingCommand, { level: 2 }))}>
          <Heading2 size={18} />
        </ToolbarButton>
        <ToolbarButton label="Heading 3" onClick={() => run(dispatch(Commands.SetHeadingCommand, { level: 3 }))}>
          <Heading3 size={18} />
        </ToolbarButton>
      </div>
      <div className="toolbar-group">
        <ToolbarButton label="Insert callout" disabled={insertPending} onClick={() => insert("callout")}>
          <Quote size={17} />
        </ToolbarButton>
        <ToolbarButton label="Insert task" disabled={insertPending} onClick={() => insert("task")}>
          <ClipboardCheck size={17} />
        </ToolbarButton>
        <ToolbarButton label="Insert quiz" disabled={insertPending} onClick={() => insert("quiz")}>
          <ListChecks size={17} />
        </ToolbarButton>
        <ToolbarButton label="Insert media" disabled={insertPending} onClick={() => insert("media")}>
          <Image size={17} />
        </ToolbarButton>
        <ToolbarButton label="Mention reviewer" disabled={insertPending} onClick={() => insert("mention")}>
          <UserRound size={17} />
        </ToolbarButton>
      </div>
      <div className="toolbar-group">
        <ToolbarButton label="Undo" disabled={history.past.length === 0} onClick={() => run(history.undo())}>
          <Undo2 size={17} />
        </ToolbarButton>
        <ToolbarButton label="Redo" disabled={history.future.length === 0} onClick={() => run(history.redo())}>
          <Redo2 size={17} />
        </ToolbarButton>
      </div>
    </div>
  )
}

function TextBubbleMenu() {
  const dispatch = useDispatch()
  const hasSelection = useEditorSlice(hasSelectionAtom)
  const selectedText = useEditorSlice(selectedTextAtom)

  return (
    <BubbleMenu
      pluginKey="lab-text-menu"
      updateDelay={100}
      shouldShow={() => hasSelection && selectedText.trim().length > 0}
      className="bubble-menu"
    >
      <ToolbarButton label="Bold" onClick={() => run(dispatch(Commands.ToggleMarkCommand("bold"), undefined))}>
        <Bold size={16} />
      </ToolbarButton>
      <ToolbarButton label="Italic" onClick={() => run(dispatch(Commands.ToggleMarkCommand("italic"), undefined))}>
        <Italic size={16} />
      </ToolbarButton>
      <button type="button" className="bubble-action" onClick={() => run(dispatch(InsertAtSelectionCommand, { content: blockFactories.callout() }))}>
        <Sparkles size={15} />
        Note
      </button>
    </BubbleMenu>
  )
}

function InsertMenu() {
  const dispatch = useDispatch()

  return (
    <FloatingMenu pluginKey="lab-insert-menu" className="floating-menu" shouldShow={({ editor }) => editor.isActive("paragraph")}>
      <button type="button" onClick={() => run(dispatch(InsertAtSelectionCommand, { content: blockFactories.callout() }))}>
        <Quote size={16} />
        Callout
      </button>
      <button type="button" onClick={() => run(dispatch(InsertAtSelectionCommand, { content: blockFactories.quiz() }))}>
        <ListChecks size={16} />
        Quiz
      </button>
      <button type="button" onClick={() => run(dispatch(InsertAtSelectionCommand, { content: blockFactories.task() }))}>
        <ClipboardCheck size={16} />
        Task
      </button>
    </FloatingMenu>
  )
}

function OutlinePanel() {
  const doc = useEditorSlice((scopeId) => docAtom(scopeId, courseSchema), { debounceMs: 120 })

  const headings = React.useMemo(() => {
    if (!doc || !Result.isSuccess(doc)) return []
    return (doc.value.content ?? [])
      .filter((node) => node.type === "heading")
      .map((node) => ({
        level: Number(node.attrs?.level ?? 1),
        text: (node.content ?? []).map((child) => child.text ?? "").join(""),
      }))
  }, [doc])

  return (
    <aside className="left-panel">
      <div className="panel-title">
        <BookOpen size={16} />
        Course outline
      </div>
      <div className="outline-list">
        {headings.map((heading, index) => (
          <button key={`${heading.text}-${index}`} type="button" data-level={heading.level}>
            {heading.text}
          </button>
        ))}
      </div>
      <div className="insert-palette">
        <span>Insert blocks</span>
        <PaletteButton kind="callout" icon={<Quote size={16} />} label="Callout" />
        <PaletteButton kind="task" icon={<ClipboardCheck size={16} />} label="Task" />
        <PaletteButton kind="quiz" icon={<ListChecks size={16} />} label="Quiz" />
        <PaletteButton kind="media" icon={<Image size={16} />} label="Media" />
        <PaletteButton kind="mention" icon={<UserRound size={16} />} label="Mention" />
      </div>
    </aside>
  )
}

function PaletteButton({
  kind,
  icon,
  label,
}: {
  kind: keyof typeof blockFactories
  icon: React.ReactNode
  label: string
}) {
  const dispatch = useDispatch()
  return (
    <button type="button" onClick={() => run(dispatch(InsertAtSelectionCommand, { content: blockFactories[kind]() }))}>
      {icon}
      {label}
      <Plus size={14} />
    </button>
  )
}

function SaveStatus() {
  const doc = useEditorSlice((scopeId) => docAtom(scopeId, courseSchema), { debounceMs: 800 })
  const [savedAt, setSavedAt] = React.useState("Not saved yet")

  React.useEffect(() => {
    if (!doc || !Result.isSuccess(doc)) return
    window.localStorage.setItem("tiptap-effect-next-editor-lab-doc", JSON.stringify(doc.value))
    setSavedAt(new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()))
  }, [doc])

  return (
    <div className="save-status">
      <Save size={15} />
      <span>Autosaved {savedAt}</span>
    </div>
  )
}

function InspectorPanel() {
  const doc = useEditorSlice((scopeId) => docAtom(scopeId, courseSchema), { debounceMs: 250 })
  const html = useEditorSlice((scopeId) => htmlAtom(scopeId, courseSchema), { debounceMs: 250 })
  const text = useEditorSlice(plainTextAtom)
  const selectedText = useEditorSlice(selectedTextAtom)
  const selection = useEditorSlice(selectionAtom)
  const history = useHistory()
  const [errors, setErrors] = React.useState<string[]>([])

  useCommandErrors((event) => {
    setErrors((current) => [`${event.op}: ${String(event.cause)}`, ...current].slice(0, 4))
  })

  const decoded = doc && Result.isSuccess(doc) ? doc.value : initialContent
  const docStatus =
    doc === null ? "Initial document"
      : Result.isSuccess(doc) ? "Live transaction"
        : "Schema decode failed"
  const htmlSnapshot = html || generateHTML(initialContent as never, courseSchema.tiptapExtensions)
  const blockCount = decoded?.content?.length ?? 0

  return (
    <aside className="right-panel">
      <section className="panel-card compact">
        <div className="panel-title">
          <Activity size={16} />
          Live state
        </div>
        <dl className="stat-grid">
          <div><dt>Blocks</dt><dd>{blockCount}</dd></div>
          <div><dt>Words</dt><dd>{text.trim() ? text.trim().split(/\s+/).length : 0}</dd></div>
          <div><dt>Undo</dt><dd>{history.past.length}</dd></div>
          <div><dt>Redo</dt><dd>{history.future.length}</dd></div>
        </dl>
      </section>
      <section className="panel-card">
        <div className="panel-title">
          <PanelRight size={16} />
          Selection
        </div>
        <p className="muted">{selectedText || "No selected text"}</p>
        <code>{selection?.kind ?? "unknown"}</code>
      </section>
      <section className="panel-card">
        <div className="panel-title">
          <History size={16} />
          Command history
        </div>
        <div className="history-list">
          {history.past.slice(-5).reverse().map((record) => (
            <span key={`${record.op}-${record.at}`}>{record.op}</span>
          ))}
          {history.past.length === 0 && <p className="muted">No commands yet</p>}
        </div>
      </section>
      <section className="panel-card">
        <div className="panel-title">
          <FileJson size={16} />
          Persisted JSON
        </div>
        <p className="snapshot-status">{docStatus}</p>
        <pre>{JSON.stringify(decoded, null, 2).slice(0, 1800)}</pre>
      </section>
      <section className="panel-card">
        <div className="panel-title">
          <Code2 size={16} />
          HTML snapshot
        </div>
        <p className="snapshot-status">{html ? "Live transaction" : "Initial document"}</p>
        <pre>{htmlSnapshot.slice(0, 900)}</pre>
      </section>
      {errors.length > 0 && (
        <section className="panel-card danger">
          <div className="panel-title">Command errors</div>
          {errors.map((error) => <p key={error}>{error}</p>)}
        </section>
      )}
    </aside>
  )
}

function ResetButton() {
  const dispatchPromise = useDispatchPromise()

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => dispatchPromise(Commands.SetContentCommand, { content: initialContent })}
    >
      <RotateCcw size={16} />
      Reset content
    </button>
  )
}

function EditorWorkspace() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">FrontCore LMS inspired lab</span>
          <h1>Course section editor</h1>
        </div>
        <div className="topbar-actions">
          <SaveStatus />
          <ResetButton />
        </div>
      </header>
      <div className="workspace">
        <OutlinePanel />
        <main className="editor-column">
          <div className="course-strip">
            <span>AI Course editor</span>
            <ChevronDown size={15} />
            <span>Leadership onboarding</span>
            <ChevronDown size={15} />
            <strong>Decision quality</strong>
          </div>
          <FormatToolbar />
          <div className="editor-surface">
            <TextBubbleMenu />
            <InsertMenu />
            <TiptapView className="editor-host" />
          </div>
        </main>
        <InspectorPanel />
      </div>
    </div>
  )
}

function useStableRegistry() {
  const registryRef = React.useRef<ReturnType<typeof Registry.make> | null>(null)

  if (registryRef.current === null) {
    registryRef.current = Registry.make()
  }

  return registryRef.current
}

function EditorLabClient() {
  const registry = useStableRegistry()
  const spec = React.useMemo(
    () => ({
      id: editorId,
      schema: courseSchema,
      defaultContent: initialContent,
      devSchemaCheck: true,
      editorProps: {
        attributes: {
          autocomplete: "off",
          autocorrect: "off",
          autocapitalize: "off",
          "aria-label": "Course section body",
          class: "ProseMirror-lab",
        },
      },
    }) satisfies EditorSpec<Record<string, unknown>, Record<string, unknown>>,
    [],
  )

  return (
    <RegistryContext.Provider value={registry}>
      <EditorScope id={editorId} spec={spec}>
        <EditorWorkspace />
      </EditorScope>
    </RegistryContext.Provider>
  )
}

export function EditorLab() {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="boot-screen">
        <div>
          <span className="eyebrow">tiptap-effect</span>
          <h1>Preparing editor lab</h1>
        </div>
      </div>
    )
  }

  return <EditorLabClient />
}
