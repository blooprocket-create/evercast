import type Decimal from 'break_eternity.js';
import { big } from '../../engine/numbers';
import type { SimulationSnapshot } from '../../engine/types';

/**
 * What the player actually does per second: every projectile, crit weighted by
 * chance, over the cast interval the engine is really using. One definition so
 * the dashboard and the spell-tree inspector can never quote different numbers.
 */
export function effectiveDps(snapshot: SimulationSnapshot): Decimal {
  const interval = Math.max(0.01, snapshot.castInterval);
  const critFactor = 1 + snapshot.critChance * Math.max(0, snapshot.critMultiplier - 1);
  return big(snapshot.damagePerProjectile.raw)
    .mul(snapshot.projectileCount)
    .mul(critFactor)
    .div(interval);
}
