import { Atom } from "@effect-atom/atom"
import { Layer } from "effect"
import { CommandExecutorLive } from "../command/command-executor"
import { DirtyTrackerLive } from "../dirty/internal/tracker"
import { TransactionBusLive } from "./internal/transaction-bus"

/**
 * The package's Effect Layer. Wires every service that Commands and atoms
 * need. `CommandErrorHandler` (US-08) and the rest land in later stories.
 */
export const TiptapLayer = Layer.mergeAll(
  TransactionBusLive,
  CommandExecutorLive,
  DirtyTrackerLive,
)

/**
 * The runtime atom used by every Command and every editor atom. Built once
 * from `TiptapLayer`, it provides a `ManagedRuntime` whose lifetime is bound
 * to the atom registry.
 */
export const editorRuntime = Atom.runtime(TiptapLayer)
