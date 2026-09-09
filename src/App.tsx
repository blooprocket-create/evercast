import { useEffect, useRef, useState } from 'react';
import { startGameLoop } from './app/GameLoop';
import { initialOfflineSummary, runCommand, runCommandRepeated } from './app/runtime';
import type { OfflineSummary } from './engine/offline/OfflineProgressor';
import { EvercastScene } from './game/EvercastScene';
import { AppShell } from './ui/shell/AppShell';
import { CommandProvider } from './ui/state/CommandContext';
import { useUiSettings } from './ui/state/useUiSettings';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<EvercastScene | null>(null);
  const [awayProgress, setAwayProgress] = useState<OfflineSummary | null>(initialOfflineSummary);
  const { depthOfField, vfxQuality, damageNumbers } = useUiSettings().display;

  // Effect budgets are fixed when the pool is built, so quality is the one
  // display setting that needs the scene rebuilding. The simulation is a module
  // singleton and keeps running, so no progress rides on this.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new EvercastScene(canvas, vfxQuality);
    sceneRef.current = scene;
    const stop = startGameLoop({ scene, onAwayProgress: setAwayProgress });

    return () => {
      stop();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [vfxQuality]);

  // Applied live, and again after a rebuild - hence vfxQuality in the deps.
  useEffect(() => {
    sceneRef.current?.setDepthOfField(depthOfField);
  }, [depthOfField, vfxQuality]);

  useEffect(() => {
    sceneRef.current?.setDamageNumbersVisible(damageNumbers);
  }, [damageNumbers, vfxQuality]);

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
