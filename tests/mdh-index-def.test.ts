import { describe, it, expect } from 'vitest';
import {
  toCreateIndexDefinition,
  classifyIndexType,
  redundantIndexNames,
  formatBytes,
  collectionIndexSummary,
  isFullWildcard,
  coveringWildcardIndex,
} from '../src/mdh/indexDef.js';

describe('toCreateIndexDefinition', () => {
  it('turns the real listed sample into a clean create-ready definition', () => {
    // Verbatim from a live /indexes/list response (a customer dev org, PRODUCTS).
    expect(toCreateIndexDefinition({ v: 2, key: { ALT1: 1 }, name: 'products_alt1_idx' })).toEqual({
      indexName: 'products_alt1_idx',
      keys: { ALT1: 1 },
    });
  });

  it('nests option siblings under options', () => {
    expect(
      toCreateIndexDefinition({
        v: 2,
        key: { email: 1 },
        name: 'email_1',
        unique: true,
        sparse: true,
      }),
    ).toEqual({
      indexName: 'email_1',
      keys: { email: 1 },
      options: { unique: true, sparse: true },
    });
  });

  it('omits the options key entirely when there are no options', () => {
    const out = toCreateIndexDefinition({ v: 2, key: { _id: 1 }, name: '_id_' });
    expect(out).toEqual({ indexName: '_id_', keys: { _id: 1 } });
    expect(out).not.toHaveProperty('options');
  });

  it('drops output-only v/ns while keeping real options', () => {
    const out = toCreateIndexDefinition({
      v: 2,
      key: { a: 1 },
      name: 'a_1',
      ns: 'db.coll',
      unique: true,
    });
    expect(out).toEqual({ indexName: 'a_1', keys: { a: 1 }, options: { unique: true } });
  });

  it('rebuilds a text index key from weights so it can be recreated', () => {
    // listIndexes returns the internal { _fts, _ftsx } key; real fields are in weights.
    const out = toCreateIndexDefinition({
      v: 2,
      key: { _fts: 'text', _ftsx: 1 },
      name: 'desc_text',
      ns: 'db.coll',
      textIndexVersion: 3,
      weights: { desc: 1 },
      default_language: 'english',
    })!;
    expect(out.keys).toEqual({ desc: 'text' });
    expect(out.keys).not.toHaveProperty('_fts');
    expect(out.keys).not.toHaveProperty('_ftsx');
    expect(out.options).toEqual({ weights: { desc: 1 }, default_language: 'english' });
    expect(out.options).not.toHaveProperty('textIndexVersion');
  });

  it('rebuilds a compound text index, preserving non-text key components and order', () => {
    const out = toCreateIndexDefinition({
      v: 2,
      key: { tenant: 1, _fts: 'text', _ftsx: 1 },
      name: 'tenant_text',
      weights: { desc: 1, title: 2 },
    });
    expect(out!.keys).toEqual({ tenant: 1, desc: 'text', title: 'text' });
  });

  it('returns non-object input unchanged', () => {
    expect(toCreateIndexDefinition(null)).toBe(null);
    expect(toCreateIndexDefinition('x')).toBe('x');
  });
});

describe('classifyIndexType', () => {
  it('classifies single, compound, text, hashed, 2dsphere, wildcard', () => {
    expect(classifyIndexType({ a: 1 })).toBe('single');
    expect(classifyIndexType({ a: 1, b: -1 })).toBe('compound');
    expect(classifyIndexType({ _fts: 'text', _ftsx: 1 })).toBe('text');
    expect(classifyIndexType({ a: 'hashed' })).toBe('hashed');
    expect(classifyIndexType({ loc: '2dsphere' })).toBe('2dsphere');
    expect(classifyIndexType({ loc: '2d' })).toBe('2d');
    expect(classifyIndexType({ '$**': 1 })).toBe('wildcard');
    expect(classifyIndexType({ 'a.$**': 1 })).toBe('wildcard');
  });

  it('returns null for a missing/invalid key', () => {
    expect(classifyIndexType(null)).toBe(null);
    expect(classifyIndexType('x')).toBe(null);
  });
});

describe('redundantIndexNames', () => {
  it('flags a plain index whose key is a strict prefix of another', () => {
    const out = redundantIndexNames([
      { key: { a: 1 }, name: 'a_1' },
      { key: { a: 1, b: 1 }, name: 'a_1_b_1' },
    ]);
    expect([...out]).toEqual(['a_1']);
  });

  it('never flags the _id_ index', () => {
    const out = redundantIndexNames([
      { key: { _id: 1 }, name: '_id_' },
      { key: { _id: 1, x: 1 }, name: '_id_1_x_1' },
    ]);
    expect(out.has('_id_')).toBe(false);
  });

  it('does not flag a constraint-bearing prefix (unique/sparse/partial/TTL)', () => {
    const out = redundantIndexNames([
      { key: { a: 1 }, name: 'a_unique', unique: true },
      { key: { a: 1, b: 1 }, name: 'a_1_b_1' },
    ]);
    expect(out.has('a_unique')).toBe(false);
  });

  it('does not treat a direction mismatch as a prefix', () => {
    const out = redundantIndexNames([
      { key: { a: -1 }, name: 'a_desc' },
      { key: { a: 1, b: 1 }, name: 'a_1_b_1' },
    ]);
    expect(out.size).toBe(0);
  });

  it('does not flag an equal-length or non-prefix index', () => {
    const out = redundantIndexNames([
      { key: { a: 1 }, name: 'a_1' },
      { key: { b: 1 }, name: 'b_1' },
    ]);
    expect(out.size).toBe(0);
  });

  it('does not flag when the only superset is partial/sparse/collation/hidden (does not fully cover)', () => {
    for (const opt of [
      { partialFilterExpression: { archived: false } },
      { sparse: true },
      { collation: { locale: 'en' } },
      { hidden: true },
    ]) {
      const out = redundantIndexNames([
        { key: { a: 1 }, name: 'a_1' },
        { key: { a: 1, b: 1 }, name: 'superset', ...opt },
      ]);
      expect(out.has('a_1'), `superset ${JSON.stringify(opt)} should not make a_1 redundant`).toBe(
        false,
      );
    }
  });

  it('still flags when the superset is unique (uniqueness does not restrict read coverage)', () => {
    const out = redundantIndexNames([
      { key: { a: 1 }, name: 'a_1' },
      { key: { a: 1, b: 1 }, name: 'superset', unique: true },
    ]);
    expect(out.has('a_1')).toBe(true);
  });
});

describe('formatBytes', () => {
  it('formats bytes/KB/MB/GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(913408)).toBe('892 KB');
    expect(formatBytes(303104)).toBe('296 KB');
    expect(formatBytes(1216512)).toBe('1.16 MB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.00 GB');
  });

  it('returns empty string for null/NaN', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(Infinity)).toBe('');
  });
});

describe('redundantIndexNames — wildcard awareness', () => {
  const wildcard = { name: '__dynamic_index', key: { '$**': 1 } };

  // Every scalar path is already indexed individually, so a hand-made
  // single-field index adds nothing. Measured 2026-09-01: some collections
  // carry this index and some carry only _id_, and nothing on screen says which.
  it('flags a plain single-field index when a wildcard index is present', () => {
    const out = redundantIndexNames([wildcard, { name: 'by_code', key: { code: 1 } }]);
    expect(out.has('by_code')).toBe(true);
  });

  // A wildcard index serves ONE field per plan — measured, from a real cached
  // query that IXSCANned one predicate and FETCH-filtered the other at 420 docs
  // examined for 8 rows. So a compound index is never redundant against it.
  it('does not flag a compound index against a wildcard', () => {
    const out = redundantIndexNames([wildcard, { name: 'by_two', key: { a: 1, b: 1 } }]);
    expect(out.has('by_two')).toBe(false);
  });

  // Each constraint is a separate reason, so each gets its own case: a wildcard
  // index cannot enforce uniqueness, expire documents, or index a subset.
  it.each([
    ['unique', { unique: true }],
    ['TTL', { expireAfterSeconds: 3600 }],
    ['partial', { partialFilterExpression: { status: 'active' } }],
    ['sparse', { sparse: true }],
    ['collation', { collation: { locale: 'en' } }],
  ])('does not flag a %s single-field index against a wildcard', (_label, opts) => {
    const out = redundantIndexNames([wildcard, { name: 'constrained', key: { code: 1 }, ...opts }]);
    expect(out.has('constrained')).toBe(false);
  });

  it.each([
    ['partial', { partialFilterExpression: { status: 'active' } }],
    ['sparse', { sparse: true }],
    ['hidden', { hidden: true }],
  ])('does not flag against a %s wildcard — it does not cover everything', (_label, opts) => {
    const out = redundantIndexNames([
      { ...wildcard, ...opts },
      { name: 'by_code', key: { code: 1 } },
    ]);
    expect(out.has('by_code')).toBe(false);
  });

  it('never flags _id_', () => {
    const out = redundantIndexNames([wildcard, { name: '_id_', key: { _id: 1 } }]);
    expect(out.has('_id_')).toBe(false);
  });
});

describe('redundantIndexNames — the sparse:false correction', () => {
  const wildcard = { name: '__dynamic_index', key: { '$**': 1 } };

  // indexes/list echoes `sparse: false` back for an index created with it
  // (measured 2026-09-01). `=== undefined` read that as a constraint, so the
  // index was silently skipped. Falsiness is the right test for the booleans.
  it('treats sparse:false as plain', () => {
    const out = redundantIndexNames([
      wildcard,
      { name: 'by_code', key: { code: 1 }, sparse: false },
    ]);
    expect(out.has('by_code')).toBe(true);
  });

  // The trap: falsiness must NOT be applied to the value-carrying options.
  // A TTL of 0 seconds is a legitimate TTL index and must stay constrained.
  it('treats expireAfterSeconds:0 as a real TTL constraint', () => {
    const out = redundantIndexNames([
      wildcard,
      { name: 'ttl_zero', key: { ts: 1 }, expireAfterSeconds: 0 },
    ]);
    expect(out.has('ttl_zero')).toBe(false);
  });
});

describe('redundantIndexNames — narrow wildcard coverage', () => {
  const fullWildcard = { name: '__dynamic_index', key: { '$**': 1 } };

  // A subpath wildcard indexes only paths under `a` — it does not cover an
  // unrelated top-level field. Flagging `by_code` here would badge a
  // genuinely load-bearing index as droppable.
  it('does not flag an unrelated field against a subpath wildcard', () => {
    const out = redundantIndexNames([
      { name: 'subpath_wc', key: { 'a.$**': 1 } },
      { name: 'by_code', key: { code: 1 } },
    ]);
    expect(out.has('by_code')).toBe(false);
  });

  // A compound wildcard with a prefix field only serves queries with equality
  // on that prefix — it does not cover an unrelated field either.
  it('does not flag an unrelated field against a compound wildcard with a prefix field', () => {
    const out = redundantIndexNames([
      { name: 'compound_wc', key: { tenant: 1, '$**': 1 } },
      { name: 'by_code', key: { code: 1 } },
    ]);
    expect(out.has('by_code')).toBe(false);
  });

  // The skip stays broad: neither new shape is ever flagged against itself,
  // even though neither counts as a covering wildcard.
  it('never flags the subpath or compound wildcard indexes themselves', () => {
    const out = redundantIndexNames([
      { name: 'subpath_wc', key: { 'a.$**': 1 } },
      { name: 'compound_wc', key: { tenant: 1, '$**': 1 } },
    ]);
    expect(out.has('subpath_wc')).toBe(false);
    expect(out.has('compound_wc')).toBe(false);
  });
});

describe('collectionIndexSummary', () => {
  const wildcard = { name: '__dynamic_index', key: { '$**': 1 } };

  it('says a single-field index adds nothing when a wildcard is present', () => {
    const s = collectionIndexSummary([{ name: '_id_', key: { _id: 1 } }, wildcard]);
    expect(s).toContain('Every field is already indexed');
    expect(s).toContain('compound');
  });

  // The actionable one: no index but _id_ means every query is a full scan,
  // and nothing on screen said so before this.
  it('warns when the collection has nothing but _id_', () => {
    const s = collectionIndexSummary([{ name: '_id_', key: { _id: 1 } }]);
    expect(s).toContain('full scan');
  });

  it('says neither when user indexes exist and no wildcard does', () => {
    const s = collectionIndexSummary([
      { name: '_id_', key: { _id: 1 } },
      { name: 'by_code', key: { code: 1 } },
    ]);
    expect(s).toBe('');
  });

  it('does not count a system digest index as a user index', () => {
    const s = collectionIndexSummary([
      { name: '_id_', key: { _id: 1 } },
      { name: '__digest_md5_idx', key: { __digest_md5: 1 } },
    ]);
    expect(s).toContain('full scan');
  });

  it('returns an empty string rather than throwing on junk', () => {
    expect(collectionIndexSummary(null as any)).toBe('');
    expect(collectionIndexSummary([null, 42] as any)).toBe('');
  });

  // An unrecognised `__`-prefixed index still counts as a real user index —
  // SYSTEM_INDEX_NAMES is a literal name Set, not a prefix match. Untested
  // before this: the assumption the next case leans on.
  it('counts an unrecognised __-prefixed index as a user index', () => {
    const s = collectionIndexSummary([
      { name: '_id_', key: { _id: 1 } },
      { name: '__something_else', key: { a: 1 } },
    ]);
    expect(s).toBe('');
  });

  // A `__dynamic_index` keyed as a subpath wildcard (not the full `{"$**": 1}`
  // this repo has only ever observed live) is a real index serving queries
  // under `a`. It fails the narrow full-wildcard check, and without the
  // silence guard it also fails the literal SYSTEM_INDEX_NAMES membership
  // test as a "real" index (the name IS in that set), leaving userIndexes
  // empty and wrongly asserting "full scan" against an index that exists.
  it('says nothing when __dynamic_index is a subpath wildcard, not a full one', () => {
    const s = collectionIndexSummary([
      { name: '_id_', key: { _id: 1 } },
      { name: '__dynamic_index', key: { 'a.$**': 1 } },
    ]);
    expect(s).toBe('');
  });
});

// FINDING 1 (Critical): the redundancy rule skipped only `_id_` by name, so a
// plain single-field SERVICE index — `__digest_md5_idx`, which backs MDH's
// differential-sync change detection — was flagged `redundant?` the moment a
// covering wildcard was present. Three of seven live-probed collections carry
// exactly this trio. Dropping it would degrade MDH sync on a customer's data.
describe('redundantIndexNames — service-managed indexes are never flagged (Finding 1)', () => {
  const trio = [
    { name: '_id_', key: { _id: 1 } },
    { name: '__digest_md5_idx', key: { __digest_md5: 1 } },
    { name: '__dynamic_index', key: { '$**': 1 } },
  ];

  it('does not flag __digest_md5_idx against a covering wildcard (the live trio)', () => {
    const out = redundantIndexNames(trio);
    expect(out.has('__digest_md5_idx')).toBe(false);
  });

  it('never flags __dynamic_index itself', () => {
    const out = redundantIndexNames(trio);
    expect(out.has('__dynamic_index')).toBe(false);
  });

  it('still flags an ordinary user index in the same collection', () => {
    const out = redundantIndexNames([...trio, { name: 'by_code', key: { code: 1 } }]);
    expect(out.has('by_code')).toBe(true);
  });
});

// FINDING 2 (Important): a wildcard carrying `wildcardProjection` indexes
// only the projected paths, not every scalar path — isFullWildcard inspected
// the key shape only and missed this.
describe('isFullWildcard — wildcardProjection narrows coverage (Finding 2)', () => {
  it('is false for a wildcard restricted by wildcardProjection', () => {
    expect(isFullWildcard({ key: { '$**': 1 }, wildcardProjection: { a: 1 } })).toBe(false);
  });

  it('is still true for a plain full wildcard with no projection', () => {
    expect(isFullWildcard({ key: { '$**': 1 } })).toBe(true);
  });
});

describe('redundantIndexNames — a projected wildcard does not cover an unrelated field', () => {
  it('does not flag by_code against a wildcardProjection wildcard', () => {
    const out = redundantIndexNames([
      { name: 'proj_wc', key: { '$**': 1 }, wildcardProjection: { a: 1 } },
      { name: 'by_code', key: { code: 1 } },
    ]);
    expect(out.has('by_code')).toBe(false);
  });
});

// FINDING 3 (Important): the key-shape half of "does this cover everything"
// was already unified into isFullWildcard, but the options half (partial /
// sparse / collated / hidden) was re-derived inline in redundantIndexNames
// and simply skipped in collectionIndexSummary and IndexPanel. This is the
// single exported answer to the whole question; every consumer must use it.
describe('coveringWildcardIndex — the single source of truth (Finding 3)', () => {
  const fullWildcard = { name: '__dynamic_index', key: { '$**': 1 } };

  it('returns the covering wildcard index when one genuinely covers everything', () => {
    expect(coveringWildcardIndex([fullWildcard])).toBe(fullWildcard);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['partial', { partialFilterExpression: { status: 'active' } }],
    ['sparse', { sparse: true }],
    ['collation', { collation: { locale: 'en' } }],
  ])('returns null for a %s wildcard — it does not cover everything', (_label, opts) => {
    expect(coveringWildcardIndex([{ ...fullWildcard, ...opts }])).toBe(null);
  });

  it('returns null for a wildcard restricted by wildcardProjection', () => {
    expect(
      coveringWildcardIndex([{ name: 'proj_wc', key: { '$**': 1 }, wildcardProjection: { a: 1 } }]),
    ).toBe(null);
  });

  it('returns null for a subpath or compound-prefix wildcard', () => {
    expect(coveringWildcardIndex([{ name: 'subpath_wc', key: { 'a.$**': 1 } }])).toBe(null);
    expect(coveringWildcardIndex([{ name: 'compound_wc', key: { tenant: 1, '$**': 1 } }])).toBe(
      null,
    );
  });

  it('returns null when there is no wildcard at all', () => {
    expect(coveringWildcardIndex([{ name: 'by_code', key: { code: 1 } }])).toBe(null);
  });

  it('returns null on junk input rather than throwing', () => {
    expect(coveringWildcardIndex(null as any)).toBe(null);
    expect(coveringWildcardIndex([null, 42] as any)).toBe(null);
  });
});

// The bug this reproduces: a `hidden: true` wildcard made redundantIndexNames
// correctly flag nothing, while collectionIndexSummary still asserted "every
// field is already indexed" — false, since a hidden index serves no query.
describe('collectionIndexSummary — the options half of coverage (Finding 3)', () => {
  it.each([
    ['hidden', { hidden: true }],
    ['partial', { partialFilterExpression: { status: 'active' } }],
    ['sparse', { sparse: true }],
  ])('makes no coverage claim when the wildcard is %s', (_label, opts) => {
    const s = collectionIndexSummary([
      { name: '_id_', key: { _id: 1 } },
      { name: '__dynamic_index', key: { '$**': 1 }, ...opts },
    ]);
    expect(s).toBe('');
  });

  it('makes no coverage claim when the wildcard is restricted by wildcardProjection', () => {
    const s = collectionIndexSummary([
      { name: '_id_', key: { _id: 1 } },
      { name: '__dynamic_index', key: { '$**': 1 }, wildcardProjection: { a: 1 } },
    ]);
    expect(s).toBe('');
  });
});
