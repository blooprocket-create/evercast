import { Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import type { GameEvent } from '../engine/events/GameEvent';
import type { CompanionSnapshot, SimulationSnapshot } from '../engine/types';
import { CompanionVisual } from './actors/CompanionVisual';

/** Feet height, matching the mage's own offset from the lane. */
const GROUND_Y = 0.025;

/**
 * The party on the field.
 *
 * Reads the snapshot for who is standing where and the event stream for what
 * they just did - the same division the enemy visuals use, and the reason the
 * renderer never has to work out combat for itself. Positions come from the
 * engine's formation, so what is drawn is where the reach was measured from.
 */
export class CompanionPresenter {
  private readonly visuals = new Map<string, CompanionVisual>();
  private seed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly shadows?: ShadowGenerator,
  ) {}

  sync(snapshot: SimulationSnapshot, deltaSeconds: number, events: readonly GameEvent[]): void {
    const fielded = new Map<string, CompanionSnapshot>();
    for (const member of snapshot.party) {
      if (member) fielded.set(member.definitionId, member);
    }

    // Anyone who left the party leaves the field with it.
    for (const [id, visual] of this.visuals) {
      if (fielded.has(id)) continue;
      visual.dispose();
      this.visuals.delete(id);
    }

    for (const member of fielded.values()) {
      let visual = this.visuals.get(member.definitionId);
      if (!visual) {
        visual = new CompanionVisual(
          this.scene,
          `companion-${member.definitionId}`,
          member.modelKey,
          member.companionClass,
          member.rarity,
          member.stars,
          (this.seed += 1.7),
          this.shadows,
        );
        // Placed exactly where it will stand, so nobody slides in from origin.
        visual.root.position.copyFrom(this.placeOf(member));
        this.visuals.set(member.definitionId, visual);
      }

      const destination = this.placeOf(member);
      visual.root.position.x += (destination.x - visual.root.position.x) * 0.25;
      visual.root.position.z += (destination.z - visual.root.position.z) * 0.25;
      // Face up the road, biased toward the camera by the same angle the rest
      // of the cast uses so nobody stands in full profile.
      visual.root.rotation.y = Math.PI * 0.5 - 0.36;
      visual.setDowned(member.downed === true);
      visual.update(deltaSeconds);
    }

    this.react(events, snapshot);
  }

  /** The effect origin for a companion's slot, for VFX that want one. */
  muzzleOf(slot: number, snapshot: SimulationSnapshot): Vector3 | undefined {
    const member = snapshot.party[slot];
    return member ? this.visuals.get(member.definitionId)?.muzzle : undefined;
  }

  private placeOf(member: CompanionSnapshot): Vector3 {
    const position = member.position;
    return position ? new Vector3(position.x, GROUND_Y, position.z) : new Vector3(0, GROUND_Y, 0);
  }

  private react(events: readonly GameEvent[], snapshot: SimulationSnapshot): void {
    for (const event of events) {
      switch (event.type) {
        case 'companion_attack':
        case 'companion_ability':
          this.bySlot(event.slot, snapshot)?.play('attack');
          break;
        case 'companion_damaged':
          this.bySlot(event.slot, snapshot)?.play('hit');
          break;
        case 'enemy_attack':
          // A blow the party soaked: the companion flinches, not the mage.
          if (event.targetSlot !== undefined) this.bySlot(event.targetSlot, snapshot)?.play('hit');
          break;
        default:
          break;
      }
    }
  }

  private bySlot(slot: number, snapshot: SimulationSnapshot): CompanionVisual | undefined {
    const member = snapshot.party[slot];
    return member ? this.visuals.get(member.definitionId) : undefined;
  }

  dispose(): void {
    for (const visual of this.visuals.values()) visual.dispose();
    this.visuals.clear();
  }
}
