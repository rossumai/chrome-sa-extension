import { describe, expect, it } from 'vitest';
import { WIP, countKinds, readableOrgs, sourceEnvInput } from '../src/rdc/deploy.js';

const enc = (s: string) => new TextEncoder().encode(s);
const tree = new Map([
  ['envs/target/workspaces/ap/queues/cost/queue.json', enc('{}')],
  ['envs/target/workspaces/ap/queues/cost/schema.json', enc('{}')],
  ['envs/target/workspaces/ap/queues/cost/formulas/total.py', enc('')],
  ['envs/target/hooks/validator.json', enc('{}')],
  ['envs/target/hooks/validator.py', enc('')],
  ['envs/target/rules/totals.json', enc('{}')],
  ['envs/target/rules/totals.py', enc('')],
  ['envs/target/labels/urgent.json', enc('{}')],
  ['envs/source/hooks/other.json', enc('{}')],
]);

describe('rdc deploy core', () => {
  it('counts one object per JSON file of each kind, for one env only', () => {
    expect(countKinds(tree, 'target')).toEqual({
      queues: 1,
      schemas: 1,
      hooks: 1,
      rules: 1,
      labels: 1,
    });
    expect(countKinds(tree, 'source').hooks).toBe(1);
  });
  it('builds the source env from the chosen org', () => {
    const s = {
      name: 'test',
      domain: 'https://partner-sandbox.rossum.app',
      orgId: 20412,
      orgName: 'Acme Test',
    };
    expect(sourceEnvInput(s, 'tok')).toEqual({
      name: 'source',
      apiBase: 'https://partner-sandbox.rossum.app/api/v1',
      orgId: 20412,
      authKind: 'token',
      token: 'tok',
    });
    expect(sourceEnvInput(s, '')).toBe('Give a token for test.');
    expect(sourceEnvInput({ ...s, domain: 'ftp://x' }, 'tok')).toBe('Not a Rossum URL: ftp://x');
  });
  it('lists the orgs a token can read, and nothing for junk', () => {
    expect(readableOrgs({ results: [{ id: 1, name: 'A' }, { id: 'x' }, { id: 2 }] })).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'org 2' },
    ]);
    expect(readableOrgs(null)).toEqual([]);
  });
  it('names what each work-in-progress feature waits for', () => {
    expect(Object.keys(WIP).sort()).toEqual([
      'history',
      'ownValues',
      'plan',
      'review',
      'secrets',
      'write',
    ]);
    for (const s of Object.values(WIP)) expect(s).toMatch(/^Not available yet\./);
  });
});
