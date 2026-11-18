import { describe, it, expect } from 'vitest';
import {
  customPreset,
  isSingleFieldPreset,
  fieldRowLabel,
  lookupKeyPreset,
  matchingCascadePreset,
  uniqueKeyPreset,
  expiringPreset,
} from '../src/mdh/indexPresets.js';

describe('lookupKeyPreset', () => {
  it('indexes one field ascending, with no options', () => {
    const p = lookupKeyPreset(['code']);
    expect(p.keys).toEqual({ code: 1 });
    expect(p.options).toBeUndefined();
  });

  it('uses only the first field — a lookup key is single-field by definition', () => {
    expect(lookupKeyPreset(['code', 'other']).keys).toEqual({ code: 1 });
  });
});

describe('matchingCascadePreset', () => {
  // Field ORDER is the whole point of a compound index, and the picker preserves
  // the order fields were added. Equality-first ordering is standard MongoDB
  // guidance; it is NOT measured on this cluster (spec §2), so nothing here or
  // in the UI copy may promise a speedup.
  it('preserves the order the fields were given', () => {
    expect(matchingCascadePreset(['status', 'code', 'ts']).keys).toEqual({
      status: 1,
      code: 1,
      ts: 1,
    });
  });

  it('emits no options', () => {
    expect(matchingCascadePreset(['a', 'b']).options).toBeUndefined();
  });
});

describe('uniqueKeyPreset', () => {
  it('sets unique, which is genuinely enforced by the service', () => {
    expect(uniqueKeyPreset(['code']).options).toEqual({ unique: true });
  });

  it('supports a compound unique key', () => {
    expect(uniqueKeyPreset(['org', 'code']).keys).toEqual({ org: 1, code: 1 });
  });
});

describe('expiringPreset', () => {
  it('sets expireAfterSeconds on one date field', () => {
    const p = expiringPreset('ts', 86400);
    expect(p.keys).toEqual({ ts: 1 });
    expect(p.options).toEqual({ expireAfterSeconds: 86400 });
  });

  // Zero is a legitimate TTL — documents expire at the field's own time.
  it('keeps a zero TTL rather than dropping it as falsy', () => {
    expect(expiringPreset('ts', 0).options).toEqual({ expireAfterSeconds: 0 });
  });
});

describe('every preset', () => {
  // The modal carries the name in its own input, never auto-filled — a suggested
  // name goes stale the moment the field selection changes.
  it('describes the definition only, never the name', () => {
    for (const p of [
      customPreset(),
      lookupKeyPreset(['code']),
      matchingCascadePreset(['status', 'code']),
      uniqueKeyPreset(['code']),
      expiringPreset('ts', 60),
    ]) {
      expect(p).not.toHaveProperty('indexName');
    }
  });

  it('ignores blank and non-string field paths', () => {
    expect(matchingCascadePreset(['ok', '  ', '', null as any]).keys).toEqual({ ok: 1 });
  });

  it('emits no keys at all when nothing usable was given', () => {
    expect(matchingCascadePreset([]).keys).toEqual({});
  });
});

describe('customPreset', () => {
  // Byte-identical to the template this panel shipped with before presets
  // existed, so the untouched Create path behaves as it always did.
  it('is the historical template minus the name, which is now its own input', () => {
    expect(customPreset()).toEqual({ keys: { field: 1 }, options: {} });
  });

  it('hands back a fresh object each time', () => {
    const a = customPreset();
    a.keys.field = 99;
    expect(customPreset().keys.field).toBe(1);
  });
});

describe('isSingleFieldPreset', () => {
  // Drives the picker into single-select, which is what makes the
  // discarded-field state unreachable instead of merely explained.
  it('is true for the presets that build a single-field index', () => {
    expect(isSingleFieldPreset('lookup')).toBe(true);
    expect(isSingleFieldPreset('expiring')).toBe(true);
  });

  it('is false for the presets that use every field, and for no preset', () => {
    for (const p of ['custom', 'cascade', 'unique'] as const) {
      expect(isSingleFieldPreset(p)).toBe(false);
    }
    expect(isSingleFieldPreset(null)).toBe(false);
  });
});

describe('fieldRowLabel', () => {
  // A label reading "Fields, in query order" over a control that uses one field
  // is the invitation that caused the confusion — it has to go singular.
  it('is singular for the single-field presets, and names what the field is for', () => {
    expect(fieldRowLabel('expiring')).toBe('Date field to expire on');
    expect(fieldRowLabel('lookup')).toBe('Field to index');
  });

  it('stays plural where order and count actually matter', () => {
    expect(fieldRowLabel('cascade')).toBe('Fields, in query order');
    expect(fieldRowLabel('unique')).toBe('Fields, in query order');
    expect(fieldRowLabel(null)).toBe('Fields, in query order');
  });
});
