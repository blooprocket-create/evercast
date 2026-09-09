import { useEffect, useRef, useState } from 'react';
import type { GearSlot } from './engine/gear/types';
import { OfflineProgressor, type OfflineSummary } from './engine/offline/OfflineProgressor';
import type { SimulationSnapshot } from './engine/types';
import { EvercastScene } from './game/EvercastScene';
import { offlineSummary, saveGame, simulation } from './app/runtime';
import { Hud } from './ui/Hud';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() => simulation.getSnapshot());
  const [awayProgress, setAwayProgress] = useState<OfflineSummary | null>(offlineSummary);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new EvercastScene(canvas);
    const backgroundProgressor = new OfflineProgressor(simulation.config.maxOfflineSeconds);
    let previous = performance.now();
    let frame = 0;
    let uiAccumulator = 0;
    let hiddenAt = document.hidden ? Date.now() : null;
    const saveInterval = window.setInterval(saveGame, 10_000);
    const onBeforeUnload = () => saveGame();

    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        saveGame();
        return;
      }

      previous = performance.now();
      if (hiddenAt === null) return;

      const elapsedSeconds = Math.max(0, (Date.now() - hiddenAt) / 1000);
      hiddenAt = null;
      setAwayProgress(backgroundProgressor.apply(simulation, elapsedSeconds));

      simulation.drainPresentationEvents();
      const next = simulation.getSnapshot();
      scene.sync(next, 0, []);
      setSnapshot(next);
      uiAccumulator = 0;
      saveGame();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const loop = (now: number) => {
      if (document.hidden) {
        previous = now;
        frame = requestAnimationFrame(loop);
        return;
      }

      const delta = Math.min((now - previous) / 1000, 0.25);
      previous = now;
      simulation.update(delta);
      const next = simulation.getSnapshot();
      scene.sync(next, delta, simulation.drainPresentationEvents());
      uiAccumulator += delta;
      if (uiAccumulator >= 0.1) {
        setSnapshot(next);
        uiAccumulator = 0;
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(saveInterval);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      saveGame();
      scene.dispose();
    };
  }, []);

  const refreshAfter = (action: () => boolean) => {
    if (!action()) return;
    setAwayProgress(null);
    setSnapshot(simulation.getSnapshot());
    saveGame();
  };

  const levelGear = (slot: GearSlot) => refreshAfter(() => simulation.execute({ type: 'level_gear', slot }));
  const buySpellPoint = () => refreshAfter(() => simulation.execute({ type: 'buy_spell_point' }));
  const activateSpellNode = (nodeId: string) => refreshAfter(() => simulation.execute({ type: 'activate_spell_node', nodeId }));
  const respecSpellTree = () => refreshAfter(() => simulation.execute({ type: 'respec_spell_tree' }));

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Evercast game world" />
      <Hud
        snapshot={snapshot}
        offlineSummary={awayProgress}
        onRetry={() => refreshAfter(() => simulation.execute({ type: 'retry_frontier' }))}
        onLevelGear={levelGear}
        onBuySpellPoint={buySpellPoint}
        onActivateSpellNode={activateSpellNode}
        onRespecSpellTree={respecSpellTree}
      />
    </main>
  );
}
