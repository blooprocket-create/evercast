import { createContext, useContext } from 'react';
import type { EngineCommand } from '../../engine/types';

/**
 * The single point through which the interface mutates the simulation.
 * Everything returns whether the engine accepted the command, so a surface can
 * reflect a rejection without reimplementing the engine's rules.
 */
export type RunCommand = (command: EngineCommand) => boolean;
export type RunCommandRepeated = (command: EngineCommand, limit: number) => number;

export interface CommandApi {
  run: RunCommand;
  runMany: RunCommandRepeated;
}

const inert: CommandApi = { run: () => false, runMany: () => 0 };

const CommandContext = createContext<CommandApi>(inert);

export function CommandProvider({
  value,
  children,
}: {
  value: CommandApi;
  children: React.ReactNode;
}) {
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommand(): RunCommand {
  return useContext(CommandContext).run;
}

/** Buy-many, applied in one batch: one publish, one save. */
export function useRepeatCommand(): RunCommandRepeated {
  return useContext(CommandContext).runMany;
}
