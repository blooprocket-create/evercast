import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? collectFiles(path) : [path];
  });
}

describe('engine dependency boundary', () => {
  const engineRoot = join(process.cwd(), 'src', 'engine');
  const engineFiles = collectFiles(engineRoot).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

  it('never imports presentation or browser runtime dependencies', () => {
    for (const file of engineFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['\"]react/);
      expect(source, file).not.toMatch(/@babylonjs/);
      expect(source, file).not.toMatch(/\bdocument\./);
      expect(source, file).not.toMatch(/\bwindow\./);
      expect(source, file).not.toMatch(/\blocalStorage\b/);
    }
  });

  it('keeps authored gear and spell-tree catalogs out of engine modules', () => {
    const combined = engineFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(combined).not.toMatch(/export const GEAR_DEFINITIONS\s*=/);
    expect(combined).not.toMatch(/export const SPELL_TREE_NODES\s*=/);
  });

  it('keeps spell-tree geometry in the UI layer', () => {
    const treeTypes = readFileSync(join(engineRoot, 'spellTree', 'types.ts'), 'utf8');
    const authoredTree = readFileSync(join(process.cwd(), 'src', 'content', 'spellTree.ts'), 'utf8');
    expect(treeTypes).not.toMatch(/\bx:\s*number/);
    expect(treeTypes).not.toMatch(/\by:\s*number/);
    expect(authoredTree).not.toMatch(/\bx:\s*\d/);
    expect(authoredTree).not.toMatch(/\by:\s*\d/);
  });

  it('keeps EvercastSimulation as a coordinator instead of a god file', () => {
    const source = readFileSync(join(engineRoot, 'EvercastSimulation.ts'), 'utf8');
    expect(source.split('\n').length).toBeLessThan(300);
    expect(source).toContain("from './snapshot/SimulationSnapshotBuilder'");
    // Narration moved behind `Chronicle`, which is the same delegation one
    // step further out: the coordinator keeps a log, it does not write one.
    expect(source).toContain("from './events/Chronicle'");
  });
});
