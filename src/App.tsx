import { useEffect, useRef, useState } from 'react';
import { ASSET_WAIT_CEILING_MS, bootPhase } from './app/BootPhase';
import { startGameLoop } from './app/GameLoop';
import { resumedFromSave, runCommand, runCommandRepeated } from './app/runtime';
import type { OfflineSummary } from './engine/offline/OfflineProgressor';
import type { EvercastScene } from './game/EvercastScene';
import { AppShell } from './ui/shell/AppShell';
import { CommandProvider } from './ui/state/CommandContext';
import { useUiSettings } from './ui/state/useUiSettings';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<EvercastScene | null>(null);
  // Away progress is reported by the game loop once it has worked the debt off.
  const [awayProgress, setAwayProgress] = useState<OfflineSummary | null>(null);
  const [assetsSettled, setAssetsSettled] = useState(false);
  const [begun, setBegun] = useState(false);
  const { depthOfField, vfxQuality, damageNumbers } = useUiSettings().display;
  const phase = bootPhase({ assetsSettled, begun });

  // Effect budgets are fixed when the pool is built, so quality is the one
  // display setting that needs the scene rebuilding. The simulation is a module
  // singleton and keeps running, so no progress rides on this.
  //
  // Babylon is fetched here rather than imported at the top of the file, and
  // that is load-bearing: it is by far the largest thing in the bundle, and an
  // eager import puts its whole parse in front of the first paint. The boot
  // gate is React and CSS, so it can be on screen while this is still arriving.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let live = true;
    let built: EvercastScene | null = null;

    void import('./game/EvercastScene')
      .then(({ EvercastScene }) => {
        if (!live) return;
        built = new EvercastScene(canvas, vfxQuality);
        setScene(built);
        return built.whenReady();
      })
      .catch((error: unknown) => {
        // A scene that cannot be built is a game with no picture, not a game
        // with no progress: the simulation is a module singleton and has been
        // running since import. Reporting beats a gate that never opens.
        console.error('Evercast could not build its scene.', error);
      })
      .finally(() => {
        if (live) setAssetsSettled(true);
      });

    return () => {
      live = false;
      built?.dispose();
      setScene(null);
    };
  }, [vfxQuality]);

  /**
   * The ceiling that stops the gate being a trap. A stalled download must cost
   * the player their scenery, never their session - `ActorAssets` already draws
   * primitives for a mesh that never came, and the simulation never wanted the
   * meshes at all.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => setAssetsSettled(true), ASSET_WAIT_CEILING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Nothing ticks until the player is looking at it. Time spent behind the gate
  // is not lost: it lands in the away debt that `runtime` stamps against the
  // save, and is settled on the first frame after Begin like any other absence.
  useEffect(() => {
    if (!scene || !begun) return;
    return startGameLoop({ scene, onAwayProgress: setAwayProgress });
  }, [scene, begun]);

  useEffect(() => {
    scene?.setDepthOfField(depthOfField);
  }, [scene, depthOfField]);

  useEffect(() => {
    scene?.setDamageNumbersVisible(damageNumbers);
  }, [scene, damageNumbers]);

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
        bootPhase={phase}
        resumedFromSave={resumedFromSave}
        onBegin={() => setBegun(true)}
        awayProgress={awayProgress}
        onDismissAwayProgress={() => setAwayProgress(null)}
      />
    </CommandProvider>
  );
}
