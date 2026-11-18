import { describe, it, expect } from 'vitest';
import { runTargets, runBucket } from '../src/fabry/architect/run.js';
import { deliverable } from './support/architect.js';

const ds = [
  deliverable({ id: 'n' }),
  deliverable({ id: 'p' }),
  deliverable({ id: 'f' }),
  deliverable({ id: 'u' }),
  deliverable({ id: 's', skipCheck: true }),
];
const results = {
  p: { verdict: 'pass' },
  f: { verdict: 'fail' },
  u: { verdict: 'uncertain' },
  s: { verdict: 'fail' },
};
const ids = (f: any[]) => runTargets(ds, results, f).map((d) => d.id);

describe('runTargets', () => {
  it('runs everything but skipped deliverables when no filter is set', () => {
    expect(ids([])).toEqual(['n', 'p', 'f', 'u']);
  });
  it('selects one bucket', () => {
    expect(ids(['new'])).toEqual(['n']);
    expect(ids(['pass'])).toEqual(['p']);
    expect(ids(['fail'])).toEqual(['f']); // 's' is red but skipped
  });
  it('combines buckets, and uncertain never matches one', () => {
    expect(ids(['new', 'fail'])).toEqual(['n', 'f']);
    expect(ids(['new', 'pass', 'fail'])).toEqual(['n', 'p', 'f']);
  });
  it('treats a result without a verdict as new', () => {
    expect(runBucket({ verdict: null })).toBe('new');
    expect(runBucket(undefined)).toBe('new');
  });
});
