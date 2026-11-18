import { describe, it, expect } from 'vitest';
import { customPreset, defaultPreset, fuzzyPreset } from '../src/mdh/searchIndexPresets.js';

describe('defaultPreset', () => {
  // Read verbatim off the `default` index the server creates with every
  // collection (probed live 2026-08-31). Recreating `default` from the editor's
  // old {"mappings":{"dynamic":true}} seed silently swapped in lucene.standard.
  it('reproduces the auto-created default index exactly', () => {
    expect(defaultPreset()).toEqual({
      mappings: { dynamic: true },
      analyzer: 'default_whitespace_lowercase',
      searchAnalyzer: 'default_whitespace_lowercase',
      analyzers: [
        {
          name: 'default_whitespace_lowercase',
          tokenizer: { type: 'whitespace' },
          tokenFilters: [{ type: 'lowercase' }],
          charFilters: [
            { type: 'mapping', mappings: { '.': ' ', '/': '', '\\': '', '-': ' ', ',': ' ' } },
          ],
        },
      ],
    });
  });

  it('hands back a fresh object each time, so editing one result cannot poison the next', () => {
    const a = defaultPreset();
    a.analyzers[0].charFilters[0].mappings['.'] = 'MUTATED';
    expect(defaultPreset().analyzers[0].charFilters[0].mappings['.']).toBe(' ');
  });
});

describe('fuzzyPreset', () => {
  it('maps each field as a folded string', () => {
    const def = fuzzyPreset(['vendor_name', 'vat']);
    expect(def.mappings.dynamic).toBe(false);
    expect(def.mappings.fields).toEqual({
      vendor_name: { type: 'string', analyzer: 'whitespace_lowercase_folded' },
      vat: { type: 'string', analyzer: 'whitespace_lowercase_folded' },
    });
  });

  // icuFolding is what takes the diacritic set from 2/8 to 7/8 (measured
  // 2026-08-31). Without it the preset is no better than the default index.
  it('defines the folded analyzer inline, with icuFolding after lowercase', () => {
    const def = fuzzyPreset(['vendor_name']);
    expect(def.analyzers).toHaveLength(1);
    expect(def.analyzers[0].tokenFilters).toEqual([{ type: 'lowercase' }, { type: 'icuFolding' }]);
  });

  // The house analyzer is NOT a cluster built-in: naming it without carrying the
  // definition builds a FAILED index, and the create call returns "accept" first.
  it('carries the analyzer definition rather than only naming it', () => {
    const def = fuzzyPreset(['vendor_name']);
    const named = def.mappings.fields.vendor_name.analyzer;
    expect(def.analyzers.map((a: any) => a.name)).toContain(named);
  });

  // Two analyzers sharing one name and behaving differently, in definitions that
  // get copied between collections, is the collision this name avoids.
  it('does not reuse the house analyzer name for the folded analyzer', () => {
    expect(fuzzyPreset(['x']).analyzers[0].name).not.toBe('default_whitespace_lowercase');
  });

  it('omits the fields key entirely when no field was chosen', () => {
    const def = fuzzyPreset([]);
    expect('fields' in def.mappings).toBe(false);
  });

  it('ignores blank and non-string paths', () => {
    const def = fuzzyPreset(['ok', '  ', '', null as any]);
    expect(Object.keys(def.mappings.fields)).toEqual(['ok']);
  });

  it('adds a keyword alternate under multi.exact when asked', () => {
    const def = fuzzyPreset(['vat'], { exactAlternate: true });
    expect(def.mappings.fields.vat.multi).toEqual({
      exact: { type: 'string', analyzer: 'lucene.keyword' },
    });
  });

  it('adds no alternate by default', () => {
    expect(fuzzyPreset(['vat']).mappings.fields.vat.multi).toBeUndefined();
  });

  // "vat.exact" is an HTTP 400 whose suggested fix — allowAnalyzedField: true —
  // silences the error and runs the regex against the analyzed field, answering
  // confidently wrong. Neither form may ever be generated.
  it('never emits a dotted .exact path or allowAnalyzedField', () => {
    const json = JSON.stringify(fuzzyPreset(['vat'], { exactAlternate: true }));
    expect(json).not.toContain('allowAnalyzedField');
    expect(json).not.toContain('vat.exact');
  });
});

describe('customPreset', () => {
  // Verified live 2026-09-01: PUT with nothing but this reaches READY and
  // queryable, and round-trips back byte-identical.
  it('is the minimal definition, and nothing more', () => {
    expect(customPreset()).toEqual({ mappings: { dynamic: true } });
  });

  it('hands back a fresh object each time', () => {
    const a = customPreset();
    a.mappings.dynamic = 'MUTATED';
    expect(customPreset().mappings.dynamic).toBe(true);
  });
});
