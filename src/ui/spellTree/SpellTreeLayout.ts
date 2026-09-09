import { SPELL_TREE_NODES } from '../../content/spellTree';
export interface SpellTreeNodeLayout {
  x: number;
  y: number;
}
export const SPELL_TREE_VIEWBOX = { width: 1800, height: 820 } as const;
const positions: Record<string, SpellTreeNodeLayout> = { evercast_root: { x: 900, y: 55 } };
for (const [routeIndex, region] of ['twin', 'piercing', 'charged'].entries()) {
  const center = 300 + routeIndex * 600;
  const nodes = SPELL_TREE_NODES.filter((n) => n.region === region);
  const route = nodes.find((n) => n.kind === 'route')!;
  positions[route.id] = { x: center, y: 155 };
  const identities = nodes.filter((n) => n.kind === 'identity');
  for (const [index, identity] of identities.entries()) {
    const x = center + (index - 1) * 185;
    positions[identity.id] = { x, y: 285 };
    const paths = nodes.filter((n) => n.kind === 'minor' && n.requiresAll.includes(identity.id));
    paths.forEach((first, lane) => {
      positions[first.id] = { x: x + (lane ? 44 : -44), y: 375 };
      const second = nodes.find((n) => n.kind === 'minor' && n.requiresAll.includes(first.id))!;
      positions[second.id] = { x: x + (lane ? 44 : -44), y: 440 };
    });
    const mutation = nodes.find((n) => n.kind === 'mutation' && n.requiresAll.includes(identity.id))!;
    positions[mutation.id] = { x, y: 540 };
  }
  for (const fusion of nodes.filter((n) => n.kind === 'fusion')) {
    const parents = fusion.requiresAll.map((id) => positions[id]);
    const outer = Math.abs(parents[0].x - parents[1].x) > 200;
    positions[fusion.id] = { x: (parents[0].x + parents[1].x) / 2, y: outer ? 755 : 655 };
  }
}
export const SPELL_TREE_LAYOUT: Readonly<Record<string, SpellTreeNodeLayout>> = positions;
export function layoutForSpellNode(id: string): SpellTreeNodeLayout {
  const layout = SPELL_TREE_LAYOUT[id];
  if (!layout) throw new Error(`Missing spell tree layout for ${id}.`);
  return layout;
}
