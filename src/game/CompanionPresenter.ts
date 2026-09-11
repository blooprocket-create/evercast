import { Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import type { CompanionAbilityId } from '../engine/companions/types';
import type { GameEvent } from '../engine/events/GameEvent';
import type { CompanionSnapshot, SimulationSnapshot } from '../engine/types';
import { CompanionVisual } from './actors/CompanionVisual';
import type { DamageNumbers } from './vfx/DamageNumbers';
import type { HealthBarTarget } from './vfx/WorldHealthBars';

/** Feet height, matching the mage's own offset from the lane. */
const GROUND_Y = 0.025;
/** Roughly head height above a companion's feet, for its bar. */
const HEAD = new Vector3(0, 1.5, 0);
/** Where a callout floats, just above the bar. */
const CALLOUT = new Vector3(0, 1.75, 0);

/** Palette for callouts, matching the interface's own meaning colours. */
const ALLY_INK = '#78b99d';
const HEAL_INK = '#9fe0c0';
const DOWN_INK = '#c4593c';
/** A bulwark eating a blow, in the same steel the interface uses for routes. */
const SHIELD_INK = '#63dcff';

/**
 * What each ability says when it fires.
 *
 * A companion using a skill has to be legible at a glance or the whole class
 * system is invisible - the player sees five figures milling about and no
 * reason to prefer any of them.
 */
const ABILITY_CALLOUT: Readonly<Record<CompanionAbilityId, string>> = {
  strike: 'STRIKE',
  volley: 'VOLLEY',
  guard: 'GUARD',
  bulwark: 'BULWARK',
  mend: 'MEND',
  rally: 'RALLY',
  hex: 'HEX',
  wither: 'WITHER',
  echo: 'ECHO',
  revive: 'LAST RITE',
};

/** Abilities that help someone rather than hurting something. */
const SUPPORTIVE: ReadonlySet<CompanionAbilityId> = new Set<CompanionAbilityId>([
  'guard',
  'bulwark',
  'mend',
  'rally',
  'revive',
]);

export interface CompanionPresenterHooks {
  /** Where an enemy instance is, for damage a companion deals. */
  enemyAnchor: (instanceId: number) => Vector3 | undefined;
  numbers: DamageNumbers;
}

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
  private readonly slots = new Map<number, string>();
  private seed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly hooks: CompanionPresenterHooks,
    private readonly shadows?: ShadowGenerator,
  ) {}

  sync(snapshot: SimulationSnapshot, deltaSeconds: number, events: readonly GameEvent[]): void {
    const fielded = new Map<string, CompanionSnapshot>();
    this.slots.clear();
    for (const member of snapshot.party) {
      if (!member) continue;
      fielded.set(member.definitionId, member);
      if (member.slot !== null) this.slots.set(member.slot, member.definitionId);
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

    this.react(events);
  }

  /**
   * Bars for the fielded party, in the same shape the enemies use.
   *
   * Only for companions that are actually hurt. Five bars plus the enemies'
   * collide into an unreadable band across the middle of a phone, and a bar
   * reading full tells the player nothing they cannot get from the party strip
   * in the shelf. Drawn only when it means something, it is the thing the eye
   * should go to.
   */
  healthBarTargets(snapshot: SimulationSnapshot): HealthBarTarget[] {
    const targets: HealthBarTarget[] = [];
    for (const member of snapshot.party) {
      if (!member || member.slot === null || !member.hp) continue;
      if (!member.downed && (member.hpPercent ?? 100) >= 99.5) continue;
      targets.push({
        id: member.slot,
        hpPercent: member.hpPercent ?? 100,
        hp: member.hp.display,
        maxHp: member.maxHp.display,
        faded: member.downed === true,
      });
    }
    return targets;
  }

  /** Head height for a party slot's bar, or null if it is not on the field. */
  headOf(slot: number): Vector3 | null {
    const visual = this.bySlot(slot);
    return visual ? visual.root.position.add(HEAD) : null;
  }

  private placeOf(member: CompanionSnapshot): Vector3 {
    const position = member.position;
    return position ? new Vector3(position.x, GROUND_Y, position.z) : new Vector3(0, GROUND_Y, 0);
  }

  /**
   * Turns the companion events into things a player can actually see: a number
   * over what was hit, a number over whoever took the blow, and the name of the
   * skill that fired. Without these the party reads as decoration.
   */
  private react(events: readonly GameEvent[]): void {
    const { numbers, enemyAnchor } = this.hooks;

    for (const event of events) {
      switch (event.type) {
        case 'companion_attack': {
          const visual = this.bySlot(event.slot);
          visual?.play('attack');
          const target = enemyAnchor(event.instanceId);
          // Negative slot ids keep companion labels from coalescing with the
          // mage's own hits on the same enemy.
          if (target) {
            numbers.show(
              { instanceId: -1000 - event.slot, critical: event.critical, damage: event.damage },
              target,
            );
          }
          break;
        }

        case 'companion_ability': {
          const visual = this.bySlot(event.slot);
          visual?.play('attack');
          if (!visual) break;
          const name = ABILITY_CALLOUT[event.ability] ?? event.ability.toUpperCase();
          numbers.callout(
            -2000 - event.slot,
            name,
            visual.root.position.add(CALLOUT),
            SUPPORTIVE.has(event.ability) ? HEAL_INK : ALLY_INK,
          );
          // Per enemy, from `hits`, never from `amount`: a volley's amount is
          // the sum across its targets, so painting it on each of them told
          // the player every enemy took the whole salvo. A debuff lands in
          // `targets` but never in `hits`, which is what keeps HEX and WITHER
          // from stamping a 0 on what they touched.
          for (const hit of event.hits) {
            const target = enemyAnchor(hit.instanceId);
            if (target) {
              numbers.show(
                { instanceId: -3000 - hit.instanceId, critical: false, damage: hit.damage },
                target,
              );
            }
          }
          break;
        }

        case 'companion_damaged': {
          const visual = this.bySlot(event.slot);
          visual?.play('hit');
          if (!visual) break;
          const where = visual.root.position.add(CALLOUT);
          if (Number(event.damage) > 0) {
            numbers.show(
              { instanceId: -4000 - event.slot, critical: false, damage: event.damage },
              where,
            );
          } else if (Number(event.absorbed) > 0) {
            // Nothing came off the bar, so a number would read as a miss. The
            // shield is the story of that hit and deserves to be the label.
            numbers.callout(-7000 - event.slot, 'BLOCK', where, SHIELD_INK);
          }
          break;
        }

        case 'companion_downed': {
          const visual = this.bySlot(event.slot);
          if (visual) numbers.callout(-5000 - event.slot, 'DOWN', visual.root.position.add(CALLOUT), DOWN_INK, 13);
          break;
        }

        case 'companion_revived': {
          const visual = this.bySlot(event.slot);
          if (visual) numbers.callout(-6000 - event.slot, 'UP', visual.root.position.add(CALLOUT), HEAL_INK, 13);
          break;
        }

        case 'enemy_attack': {
          // A blow the party soaked: the companion flinches, not the mage.
          // `companion_damaged` carries the number, so this is the animation
          // only - the two arrive together.
          if (event.targetSlot !== undefined) this.bySlot(event.targetSlot)?.play('hit');
          break;
        }

        default:
          break;
      }
    }
  }

  private bySlot(slot: number): CompanionVisual | undefined {
    const id = this.slots.get(slot);
    return id ? this.visuals.get(id) : undefined;
  }

  dispose(): void {
    for (const visual of this.visuals.values()) visual.dispose();
    this.visuals.clear();
    this.slots.clear();
  }
}
