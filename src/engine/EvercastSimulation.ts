import type { SimulationSnapshot } from './types';

const TICK_SECONDS = 0.1;

export class EvercastSimulation {
  private accumulator = 0;
  private castCooldown = 0;
  private travelTimer = 0;
  private state: SimulationSnapshot = {
    elapsedSeconds: 0,
    stage: 1,
    zone: 1,
    essence: 0,
    mageHp: 25,
    mageMaxHp: 25,
    enemyHp: 0,
    enemyMaxHp: 0,
    enemyName: 'Road ahead',
    phase: 'travel',
    casts: 0,
    kills: 0,
    projectilesPerCast: 1,
    damagePerProjectile: 2,
    castInterval: 1.35,
    progressToNextEncounter: 0,
    lastEvent: 'The Evercast stirs.',
  };

  update(deltaSeconds: number): void {
    this.accumulator += Math.min(deltaSeconds, 1);
    while (this.accumulator >= TICK_SECONDS) {
      this.tick(TICK_SECONDS);
      this.accumulator -= TICK_SECONDS;
    }
  }

  getSnapshot(): SimulationSnapshot {
    return { ...this.state };
  }

  private tick(dt: number): void {
    this.state.elapsedSeconds += dt;

    if (this.state.phase === 'travel') {
      this.travelTimer += dt;
      this.state.progressToNextEncounter = Math.min(this.travelTimer / 1.8, 1);
      if (this.travelTimer >= 1.8) this.spawnEncounter();
      return;
    }

    this.castCooldown -= dt;
    if (this.castCooldown <= 0) {
      this.castCooldown += this.state.castInterval;
      this.cast();
    }
  }

  private spawnEncounter(): void {
    this.travelTimer = 0;
    this.state.progressToNextEncounter = 0;
    const isBoss = this.state.stage % 10 === 0;
    const hp = Math.max(4, Math.floor(4 * Math.pow(1.16, this.state.stage - 1) * (isBoss ? 7 : 1)));
    this.state.enemyMaxHp = hp;
    this.state.enemyHp = hp;
    this.state.enemyName = isBoss ? `Road Warden ${this.state.stage / 10}` : this.enemyNameForStage();
    this.state.phase = isBoss ? 'boss' : 'combat';
    this.state.lastEvent = isBoss ? `${this.state.enemyName} blocks the road.` : `${this.state.enemyName} approaches.`;
    this.castCooldown = 0.15;
  }

  private cast(): void {
    const damage = this.state.damagePerProjectile * this.state.projectilesPerCast;
    this.state.casts += 1;
    this.state.enemyHp = Math.max(0, this.state.enemyHp - damage);
    this.state.lastEvent = `Arcane Bolt hits for ${damage}.`;

    if (this.state.enemyHp <= 0) {
      const reward = Math.max(1, Math.floor(Math.pow(1.12, this.state.stage - 1)));
      this.state.essence += reward;
      this.state.kills += 1;
      this.state.lastEvent = `${this.state.enemyName} falls. +${reward} Essence.`;
      this.state.stage += 1;
      this.state.zone = Math.floor((this.state.stage - 1) / 25) + 1;
      this.state.phase = 'travel';
      this.state.enemyName = 'Road ahead';
      this.state.enemyHp = 0;
      this.state.enemyMaxHp = 0;
    }
  }

  private enemyNameForStage(): string {
    const names = ['Moss Slime', 'Briarling', 'Road Imp', 'Ash Beetle', 'Hollow Crow'];
    return names[(this.state.stage - 1) % names.length];
  }
}
