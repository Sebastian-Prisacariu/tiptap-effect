import type {
  Editor as NativeEditor,
  EditorEvents as NativeEditorEvents,
} from "@tiptap/core";

export const eventNames = [
  "mount",
  "unmount",
  "beforeCreate",
  "create",
  "update",
  "selectionUpdate",
  "transaction",
  "focus",
  "blur",
  "destroy",
  "contentError",
] as const;

export type Event =
  | "mount"
  | "unmount"
  | "beforeCreate"
  | "create"
  | "update"
  | "selectionUpdate"
  | "transaction"
  | "focus"
  | "blur"
  | "destroy"
  | "contentError"

export const defaultRefreshEvents = [
  "transaction",
  "selectionUpdate",
  "update",
  "focus",
  "blur",
] as const satisfies ReadonlyArray<Event>;

export type EventArgs<EventName extends Event> =
  NativeEditorEvents[EventName] extends Array<any>
    ? NativeEditorEvents[EventName]
    : [NativeEditorEvents[EventName]];

export const onEvent = <EventName extends Event>(
  editor: NativeEditor,
  event: EventName,
  handler: (...payload: EventArgs<EventName>) => void,
) => {
  editor.on(event, handler);
};

export const offEvent = <EventName extends Event>(
  editor: NativeEditor,
  event: EventName,
  handler: (...payload: EventArgs<EventName>) => void,
) => {
  editor.off(event, handler);
};
