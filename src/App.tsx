import { useEffect, useRef, useState } from 'react';
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
    let previous = performance.now();
    let frame = 0;
    let uiAccumulator = 0;
    const saveInterval = window.setInterval(saveGame, 10_000);
    const onBeforeUnload = () => saveGame();
    window.addEventListener('beforeunload', onBeforeUnload);

    const loop = (now: number) => {
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
      saveGame();
      scene.dispose();
    };
  }, []);

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Evercast game world" />
      <Hud
        snapshot={snapshot}
        offlineSummary={offlineSummary}
        onRetry={() => simulation.execute({ type: 'retry_frontier' })}
      />
    </main>
  );
}
