import { useEffect, useRef, useState } from 'react';
import type { GearSlot } from './engine/gear/types';
import { OfflineProgressor } from './engine/offline/OfflineProgressor';
import type { SimulationSnapshot } from './engine/types';
import { EvercastScene } from './game/EvercastScene';
import { offlineSummary, saveGame, simulation } from './app/runtime';
import { Hud } from './ui/Hud';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() => simulation.getSnapshot());

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
      backgroundProgressor.apply(simulation, elapsedSeconds);

      // Background catch-up intentionally suppresses presentation events; resume from
      // the authoritative snapshot instead of replaying stale combat VFX at once.
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

  const levelGear = (slot: GearSlot) => {
    if (simulation.execute({ type: 'level_gear', slot })) {
      setSnapshot(simulation.getSnapshot());
      saveGame();
    }
  };

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Evercast game world" />
      <Hud
        snapshot={snapshot}
        offlineSummary={offlineSummary}
        onRetry={() => simulation.execute({ type: 'retry_frontier' })}
        onLevelGear={levelGear}
      />
    </main>
  );
}
