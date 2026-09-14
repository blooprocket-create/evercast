import { useEffect, useRef, useState } from 'react';
import { ASSET_WAIT_CEILING_MS, bootPhase } from './app/BootPhase';
import { startGameLoop } from './app/GameLoop';
import { creditTimeAtTheGate, resumedFromSave, runCommand, runCommandRepeated } from './app/runtime';
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
  // The loop settles the whole absence on its first frame; the gate waits for
  // it rather than lifting onto a frozen interface. See `BootConditions`.
  const [awaySettled, setAwaySettled] = useState(false);
  const [titleLit, setTitleLit] = useState(false);
  const { depthOfField, vfxQuality, damageNumbers } = useUiSettings().display;
  const phase = bootPhase({ assetsSettled, begun, awaySettled });

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

  /**
   * The title sigil, raised once the world is ready and struck the moment the
   * player begins.
   *
   * Declared above the game loop deliberately: React runs every changed effect's
   * cleanup before any create, so `hideTitle()` returns the camera to the game
   * pose before `startGameLoop` ever calls `sync()` against it. That ordering is
   * load-bearing, and putting the effects in this order is what makes it legible
   * rather than incidental.
   *
   * Nothing here is required for the game to run. No scene, a chunk that never
   * arrived, a machine with no WebGL - the effect simply never fires, `titleLit`
   * stays false, and the gate is exactly the gate that shipped before it.
   */
  useEffect(() => {
    if (!scene || phase !== 'ready') return;
    let live = true;
    void scene
      .showTitle()
      .then(() => {
        if (live) setTitleLit(true);
      })
      // A title that cannot be raised is a dark gate, which is a working gate.
      .catch(() => {});

    return () => {
      live = false;
      setTitleLit(false);
      scene.hideTitle();
    };
  }, [scene, phase]);

  /**
   * Nothing ticks until the player is looking at it - but the clock does not
   * stop for the gate, so the wait in front of it is credited as away time
   * before the loop starts and settles the lot on its first frame. Without that
   * an hour on the title screen was neither advanced live nor banked: the first
   * save after Continue stamped `now` and the hour was simply gone.
   *
   * Started with or without a scene. A renderer that failed to build costs the
   * picture; refusing to start the loop would cost the autosave too.
   */
  useEffect(() => {
    if (!begun) return;
    return startGameLoop({
      scene,
      onAwayProgress: setAwayProgress,
      onAwaySettled: () => setAwaySettled(true),
    });
  }, [scene, begun]);

  useEffect(() => {
    scene?.setDepthOfField(depthOfField);
  }, [scene, depthOfField]);

  useEffect(() => {
    scene?.setDamageNumbersVisible(damageNumbers);
  }, [scene, damageNumbers]);

  const beginPlaying = () => {
    // Before `setBegun`, so the interval ends when the player pressed the button
    // rather than whenever React next commits and the loop effect runs.
    creditTimeAtTheGate();
    setBegun(true);
  };

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
        titleLit={titleLit}
        onBegin={beginPlaying}
        awayProgress={awayProgress}
        onDismissAwayProgress={() => setAwayProgress(null)}
      />
    </CommandProvider>
  );
}
