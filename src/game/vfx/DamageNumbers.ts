import { Matrix, Scene, Vector3 } from '@babylonjs/core';
import { big, quantity } from '../../engine/numbers';
import type { Hit } from './CombatVfxPlan';

type Label = { element: HTMLSpanElement; age: number; position: Vector3; id: number; critical: boolean };
/** A small DOM pool avoids a texture/draw call for every damage label. */
export class DamageNumbers {
  private labels: Label[] = [];
  private root?: HTMLDivElement;
  constructor(private scene: Scene) {
    if (typeof document === 'undefined' || !scene.getEngine().getRenderingCanvas()) return;
    this.root = document.createElement('div');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    document.body.append(this.root);
  }
  show(hit: Pick<Hit, 'instanceId' | 'critical' | 'damage'>, position: Vector3): void {
    if (!this.root) return;
    let label =
      this.labels.find((l) => l.id === hit.instanceId && l.age < 0.1) ??
      this.labels.find((l) => l.age >= 0.65);
    if (!label && this.labels.length < 24) {
      const element = document.createElement('span');
      element.style.cssText =
        'position:absolute;left:0;top:0;font:600 12px Georgia,serif;text-shadow:0 1px 3px #18201a;will-change:transform,opacity;';
      this.root.append(element);
      label = { element, age: 1, position: Vector3.Zero(), id: 0, critical: false };
      this.labels.push(label);
    }
    if (!label) return;
    if (label.id === hit.instanceId && label.age < 0.1 && label.critical && !hit.critical) return;
    label.critical = hit.critical;
    label.id = hit.instanceId;
    label.age = 0;
    label.position.copyFrom(position);
    label.element.textContent = `${hit.critical ? '✦ ' : ''}${quantity(big(hit.damage)).display}`;
    label.element.style.color = hit.critical ? '#fff0ba' : '#ddd4f1';
    label.element.style.fontSize = hit.critical ? '16px' : '12px';
    label.element.style.opacity = '0';
  }
  update(dt: number): void {
    const canvas = this.scene.getEngine().getRenderingCanvas(),
      camera = this.scene.activeCamera;
    if (!canvas || !camera) return;
    const engine = this.scene.getEngine(),
      width = engine.getRenderWidth(),
      height = engine.getRenderHeight(),
      rect = canvas.getBoundingClientRect();
    const viewport = camera.viewport.toGlobal(width, height);
    for (const label of this.labels) {
      label.age += dt;
      if (label.age >= 0.65) {
        label.element.style.opacity = '0';
        continue;
      }
      const p = Vector3.Project(
        label.position,
        Matrix.IdentityReadOnly,
        this.scene.getTransformMatrix(),
        viewport,
      );
      label.element.style.transform = `translate(${rect.left + (p.x / width) * rect.width - 10}px,${rect.top + (p.y / height) * rect.height - 35 - label.age * 32}px)`;
      label.element.style.opacity = p.z < 0 || p.z > 1 ? '0' : String(Math.min(1, (0.65 - label.age) * 4));
    }
  }
  dispose(): void {
    this.root?.remove();
    this.root = undefined;
    this.labels.length = 0;
  }
}
