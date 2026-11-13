import { describe, it, expect } from 'vitest';
import {
  migrateOptions,
  overwrittenEdits,
  remainingAfterWrite,
  writeList,
} from '../src/rdc/plan.js';
import type { MigrateResult } from '../src/rdc/wasm.js';

const result = (over: Partial<MigrateResult>): MigrateResult => ({
  dryRun: true,
  source: 'source',
  target: 'target',
  files: [],
  objects: [],
  pruned: [],
  prunedDirs: [],
  skipped: [],
  warnings: [],
  creates: 0,
  updates: 0,
  unchanged: 0,
  deletes: 0,
  filesChanged: 0,
  renamed: 0,
  ...over,
});

describe('migrateOptions', () => {
  it('maps the plan choices to rdc migrate options', () => {
    expect(
      migrateOptions(
        {
          mirror: false,
          carry: { scoreThresholds: false, emailPrefixes: false, automation: false },
        },
        true,
      ),
    ).toEqual({ dryRun: true, mirror: false, carry: [] });
    expect(
      migrateOptions(
        { mirror: true, carry: { scoreThresholds: true, emailPrefixes: true, automation: false } },
        false,
      ),
    ).toEqual({ dryRun: false, mirror: true, carry: ['scoreThresholds', 'emailPrefixes'] });
  });
});

describe('writeList', () => {
  it("groups what Write sends to the org from rdc's dry-run plan, and keeps pulls apart", () => {
    const plan = {
      items: [
        {
          kind: 'labels',
          slug: 'hold',
          direction: 'push',
          change: 'create',
          prompt: null,
          note: 'new',
        },
        {
          kind: 'hooks',
          slug: 'old',
          direction: 'push',
          change: 'delete',
          prompt: 'deleteGate',
          note: null,
        },
        {
          kind: 'rules',
          slug: 'r',
          direction: 'both',
          change: 'conflict',
          prompt: 'conflict',
          note: 'both diverged',
        },
        {
          kind: 'queues',
          slug: 'cost',
          direction: 'pull',
          change: 'update',
          prompt: null,
          note: null,
        },
        { kind: 'hooks', slug: 'a', direction: 'push', change: 'update', prompt: null, note: null },
      ],
      recovered: [],
      problems: [],
    } as const;
    const w = writeList(plan as any);
    expect(w.create.map((i) => i.slug)).toEqual(['hold']);
    expect(w.update.map((i) => i.slug)).toEqual(['a']);
    expect(w.delete.map((i) => `${i.kind}/${i.slug}`)).toEqual(['hooks/old']);
    expect(w.conflict.map((i) => i.slug)).toEqual(['r']);
    expect(w.pull.map((i) => i.slug)).toEqual(['cost']);
  });
});

const file = (
  target: string,
  change: 'create' | 'update' | 'unchanged',
  kind: string | null,
  slug: string | null,
) => ({ source: target.replace('envs/target/', 'envs/source/'), target, change, kind, slug });
const item = (kind: string, slug: string, change: any, direction: any = 'push') => ({
  kind,
  slug,
  direction,
  change,
  prompt: null,
  note: null,
});
const r2 = result({
  files: [
    file('envs/target/hooks/a.json', 'update', 'hooks', 'a'),
    file('envs/target/hooks/a.py', 'update', 'hooks', 'a'),
    file('envs/target/rules/r.json', 'unchanged', 'rules', 'r'),
    file('envs/target/labels/l.json', 'update', 'labels', 'l'),
    file('envs/target/README.md', 'update', null, null),
  ],
  pruned: [{ target: 'envs/target/hooks/old.json', kind: 'hooks', slug: 'old' }],
});
const plan2 = {
  items: [
    item('hooks', 'a', 'update'),
    item('labels', 'l', 'update'),
    item('hooks', 'old', 'delete'),
    item('queues', 'cost', 'update', 'pull'),
  ],
  recovered: [],
  problems: [],
} as any;

describe('overwrittenEdits', () => {
  it("names each direct edit by rdc's object identity, once, when Write sends that object", () => {
    expect(
      overwrittenEdits(r2, plan2, [
        'envs/target/hooks/a.py',
        'envs/target/hooks/a.json',
        'envs/target/rules/r.json',
        'envs/target/README.md',
        'envs/target/queues/cost.json',
      ]),
    ).toEqual(['hooks/a']);
  });

  it('names a pruned direct edit by its object too, when Write deletes it', () => {
    expect(overwrittenEdits(r2, plan2, ['envs/target/hooks/old.json'])).toEqual(['hooks/old']);
  });
});

describe('remainingAfterWrite', () => {
  const edits = [
    'envs/target/hooks/a.py',
    'envs/target/labels/l.json',
    'envs/target/rules/r.json',
    'envs/target/README.md',
    'envs/target/hooks/old.json',
  ];

  it('clears exactly the objects written, pruned ones included; keeps the skipped and the untouched; drops non-objects', () => {
    expect(
      remainingAfterWrite(edits, r2, plan2, [
        { kind: 'labels', slug: 'l', reason: 'pushDriftSkipped' },
      ]),
    ).toEqual(['envs/target/labels/l.json', 'envs/target/rules/r.json']);
  });
});
