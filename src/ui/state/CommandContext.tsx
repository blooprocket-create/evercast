import { createContext, useContext } from 'react';
import type { EngineCommand } from '../../engine/types';

/**
 * The single point through which the interface mutates the simulation.
 * Everything returns whether the engine accepted the command, so a surface can
 * show a rejection without duplicating the engine's rules.
 */
export type RunCommand = (command: EngineCommand) => boolean;

const noop: RunCommand = () => false;

const CommandContext = createContext<RunCommand>(noop);

export function CommandProvider({
  run,
  children,
}: {
  run: RunCommand;
  children: React.ReactNode;
}) {
  return <CommandContext.Provider value={run}>{children}</CommandContext.Provider>;
}

export function useCommand(): RunCommand {
  return useContext(CommandContext);
}
