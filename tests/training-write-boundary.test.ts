// "Training never mutates" — with ONE deliberate exception: Start over's cleanup
// (src/academy/cleanup.ts), which deletes a run's own objects on a confirmed click
// (owner, 2026-11-16). This pins that every mutating call in training code lives
// in that one file.
//
// It walks the directories rather than naming files, and matches every source
// extension, because a guard that names or filters files goes blind — and passes —
// the moment one is renamed (CLAUDE.md, Conventions & traps).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/training', 'src/academy'];
const ALLOWED = 'src/academy/cleanup.ts';
const MUTATING = [
  /['"`](DELETE|PATCH|PUT)['"`]/,
  /collections\/(drop|create|rename)/,
  /data\/(insert|update|delete|replace|bulk_write)/,
  /\/(confirm|cancel|start|postpone|reject)['"`?]/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Training's own files: everything in the two training trees. */
const trainingFiles = () => ROOTS.flatMap(walk).filter((p) => /\.(ts|tsx|js|jsx)$/.test(p));

const hits = (path: string) => {
  const src = readFileSync(path, 'utf8');
  return MUTATING.filter((re) => re.test(src)).map((re) => `${path} ${re}`);
};

describe('the training write boundary', () => {
  it('scans a real set of files, the store and the cleanup included', () => {
    const files = trainingFiles();
    expect(files).toContain(ALLOWED);
    expect(files).toContain('src/academy/store.ts');
    expect(files.length).toBeGreaterThan(15);
  });

  it('finds the cleanup’s writes — so a miss elsewhere means there are none', () => {
    expect(hits(ALLOWED).length).toBeGreaterThanOrEqual(2);
  });

  it('has no mutating call anywhere else in training code', () => {
    expect(
      trainingFiles()
        .filter((p) => p !== ALLOWED)
        .flatMap(hits),
    ).toEqual([]);
  });
});
