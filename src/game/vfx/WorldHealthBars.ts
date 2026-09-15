import { Matrix, Scene, Vector3 } from '@babylonjs/core';


interface Bar {
  element: HTMLDivElement;
  fill: HTMLDivElement;
  readout: HTMLSpanElement;
  anchor: Vector3;
  faded?: boolean;
  opacity: number;
}

/** Anything that can wear a bar: an enemy instance, or a party slot. */
export interface HealthBarTarget {
  id: number;
  hpPercent: number;
  hp: string;
  maxHp: string;
  /** A downed companion keeps its bar, dimmed, so you can see who is out. */
  faded?: boolean;
  /**
   * How solid the thing wearing it is, 0 to 1. Defaults to 1.
   *
   * An enemy walking out of the haze is not there yet, and neither is its bar.
   */
  opacity?: number;
}

/** Foes read red, the party reads green - the same split the HUD meters use. */
export type HealthBarTone = 'foe' | 'ally';

/**
 * A health bar over each combatant's head, projected from its world position
 * every frame.
 *
 * This lives in the renderer rather than in React for the same reason
 * DamageNumbers does: it has to track a moving target at frame rate, and the
 * interface only receives a snapshot ten times a second. Bosses are excluded by
 * the caller - they get the banner at the top of the screen instead.
 *
 * One class, two instances: the enemies and the party need identical
 * projection and differ only in colour, and a companion whose bar is draining
 * is the whole point of watching a fight it is in.
 */
export class WorldHealthBars {
  private readonly bars = new Map<number, Bar>();
  private root?: HTMLDivElement;

  constructor(
    private readonly scene: Scene,
    private readonly tone: HealthBarTone = 'foe',
  ) {
    if (typeof document === 'undefined' || !scene.getEngine().getRenderingCanvas()) return;
    this.root = document.createElement('div');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    document.body.append(this.root);
  }

  private create(): Bar {
    const element = document.createElement('div');
    element.style.cssText =
      'position:absolute;left:0;top:0;width:96px;will-change:transform,opacity;' +
      'display:grid;gap:2px;justify-items:center;';

    const readout = document.createElement('span');
    readout.style.cssText =
      'font:600 9px/1 Inter,ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;' +
      'color:var(--ink-num,#e6cfb4);text-shadow:0 1px 3px rgba(6,14,16,.9);white-space:nowrap;';

    const track = document.createElement('div');
    track.style.cssText =
      'width:100%;height:4px;border-radius:999px;overflow:hidden;' +
      'background:rgba(7,13,16,.72);box-shadow:0 0 0 1px rgba(190,202,177,.22);';

    const fill = document.createElement('div');
    const ramp =
      this.tone === 'ally'
        ? 'var(--hp-you-deep,#4e8571),var(--hp-you,#78b99d)'
        : 'var(--hp-foe-deep,#8a3220),var(--hp-foe,#c4593c)';
    fill.style.cssText =
      'height:100%;border-radius:inherit;transition:width 100ms linear;' +
      `background:linear-gradient(90deg,${ramp});`;

    track.append(fill);
    element.append(readout, track);
    this.root?.append(element);
    return { element, fill, readout, anchor: Vector3.Zero(), opacity: 1 };
  }

  /** `heightOf` gives the world-space head height for a target id. */
  sync(targets: readonly HealthBarTarget[], heightOf: (id: number) => Vector3 | null): void {
    if (!this.root) return;

    const living = new Set<number>();
    for (const target of targets) {
      living.add(target.id);

      let bar = this.bars.get(target.id);
      if (!bar) {
        bar = this.create();
        this.bars.set(target.id, bar);
      }

      const head = heightOf(target.id);
      if (head) bar.anchor.copyFrom(head);
      bar.fill.style.width = `${Math.max(0, Math.min(100, target.hpPercent))}%`;
      bar.readout.textContent = `${target.hp} / ${target.maxHp}`;
      bar.faded = target.faded === true;
      bar.opacity = target.opacity ?? 1;
    }

    for (const [id, bar] of this.bars) {
      if (living.has(id)) continue;
      bar.element.remove();
      this.bars.delete(id);
    }
  }

  update(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    const camera = this.scene.activeCamera;
    if (!this.root || !canvas || !camera) return;

    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const rect = canvas.getBoundingClientRect();
    const viewport = camera.viewport.toGlobal(width, height);

    for (const bar of this.bars.values()) {
      const projected = Vector3.Project(
        bar.anchor,
        Matrix.IdentityReadOnly,
        this.scene.getTransformMatrix(),
        viewport,
      );
      const behindCamera = projected.z < 0 || projected.z > 1;
      bar.element.style.opacity = behindCamera
        ? '0'
        : ((bar.faded ? 0.4 : 1) * bar.opacity).toFixed(3);
      if (behindCamera) continue;
      bar.element.style.transform = `translate(${
        rect.left + (projected.x / width) * rect.width - 48
      }px,${rect.top + (projected.y / height) * rect.height - 34}px)`;
    }
  }

  dispose(): void {
    this.root?.remove();
    this.root = undefined;
    this.bars.clear();
  }
}
