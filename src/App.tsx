import { useEffect, useRef, useState } from 'react';
import { startGameLoop } from './app/GameLoop';
import { initialOfflineSummary, runCommand, runCommandRepeated } from './app/runtime';
import type { OfflineSummary } from './engine/offline/OfflineProgressor';
import { EvercastScene } from './game/EvercastScene';
import { AppShell } from './ui/shell/AppShell';
import { CommandProvider } from './ui/state/CommandContext';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [awayProgress, setAwayProgress] = useState<OfflineSummary | null>(initialOfflineSummary);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new EvercastScene(canvas);
    const stop = startGameLoop({ scene, onAwayProgress: setAwayProgress });

    return () => {
      stop();
      scene.dispose();
    };
  }, []);

  const commands = {
    run: (command: Parameters<typeof runCommand>[0]) => {
      const applied = runCommand(command);
      // Acting on the game dismisses the away-progress banner.
      if (applied) setAwayProgress(null);
      return applied;
    },
    runMany: (command: Parameters<typeof runCommand>[0], limit: number) => {
      const applied = runCommandRepeated(command, limit);
      if (applied > 0) setAwayProgress(null);
      return applied;
    },
  };

  return (
    <CommandProvider value={commands}>
      <AppShell
        canvasRef={canvasRef}
        awayProgress={awayProgress}
        onDismissAwayProgress={() => setAwayProgress(null)}
      />
    </CommandProvider>
  );
}
