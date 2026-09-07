import { useEffect, useRef, useState } from 'react';
import { EvercastSimulation } from './engine/EvercastSimulation';
import type { SimulationSnapshot } from './engine/types';
import { EvercastScene } from './game/EvercastScene';
import { Hud } from './ui/Hud';

const simulation = new EvercastSimulation();

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

    const loop = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.25);
      previous = now;
      simulation.update(delta);
      const next = simulation.getSnapshot();
      scene.sync(next, delta);
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
      scene.dispose();
    };
  }, []);

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Evercast game world" />
      <Hud snapshot={snapshot} />
    </main>
  );
}
