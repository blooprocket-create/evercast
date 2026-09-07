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
  it('never imports React or Babylon from src/engine', () => {
    const files = collectFiles(join(process.cwd(), 'src', 'engine')).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['\"]react/);
      expect(source, file).not.toMatch(/@babylonjs/);
    }
  });
});
