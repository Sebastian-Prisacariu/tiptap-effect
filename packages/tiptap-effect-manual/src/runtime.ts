import { Atom } from "@effect-atom/atom";
import { Layer, Logger, ManagedRuntime } from "effect";

/**
 * The package's Effect Layer. Wires every service that Commands and atoms
 * need. `CommandErrorHandler` (US-08) and the rest land in later stories.
 */
export const TiptapLayer = Layer.mergeAll(Logger.pretty);

/**
 * The runtime atom used by every Command and every editor atom. Built once
 * from `TiptapLayer`, it provides a `ManagedRuntime` whose lifetime is bound
 * to the atom registry.
 */
export const atomRuntime = Atom.runtime(TiptapLayer);

export const runtime = ManagedRuntime.make(TiptapLayer);
