import { describe, it, expect } from 'vitest';
import { TRACK, newRunCode, isRunCode, namesFor, fill, allTasks } from '../src/training/track.js';
import { vendorsCsv } from '../src/training/vendors.js';

describe('run codes', () => {
  it('are a freight word and a two-digit number', () => {
    expect(newRunCode(() => 0)).toBe('barge-10');
    expect(newRunCode(() => 0.999)).toBe('winch-99');
    for (let i = 0; i < 50; i++) expect(isRunCode(newRunCode())).toBe(true);
  });

  it('reject anything newRunCode could not have made', () => {
    expect(isRunCode('barge-17')).toBe(true);
    expect(isRunCode('jnovak')).toBe(false);
    expect(isRunCode(undefined)).toBe(false);
  });
});

describe('namesFor / fill', () => {
  it('builds the three object names from the run code, in Acme’s convention', () => {
    expect(namesFor('barge-17')).toEqual({
      queue: 'AF · AP Invoices · barge-17',
      dataset: 'af_vendor_master_barge_17',
      rule: 'AF · PO required · barge-17',
    });
  });

  it('replaces {queue}, {dataset} and {rule}, and nothing else', () => {
    expect(fill('{queue} / {dataset} / {rule} / {x}', namesFor('tug-42'))).toBe(
      'AF · AP Invoices · tug-42 / af_vendor_master_tug_42 / AF · PO required · tug-42 / {x}',
    );
  });
});

describe('TRACK', () => {
  it('is six missions, each opening with a client message and holding tasks', () => {
    expect(TRACK.missions).toHaveLength(6);
    for (const m of TRACK.missions) {
      expect(m.letter.length).toBeGreaterThan(0);
      expect(m.tasks.length).toBeGreaterThan(0);
    }
  });

  it('gives every task a unique id, a reason, a place and what it reads', () => {
    const ids = allTasks(TRACK).map(({ task }) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { task } of allTasks(TRACK)) {
      expect(task.why.length).toBeGreaterThan(10);
      expect(task.where.length).toBeGreaterThan(3);
      expect(task.needs.length).toBeGreaterThan(0);
    }
  });
});

describe('vendorsCsv', () => {
  it('is a header and 40 rows, and holds the vendor the go-live task names', () => {
    const lines = vendorsCsv().trim().split('\n');
    expect(lines[0]).toBe('id,name,vat_id,country');
    expect(lines).toHaveLength(41);
    expect(lines).toContain('V001,Nordic Pallet AB,SE556677889901,SE');
    expect(new Set(lines.slice(1).map((l) => l.split(',').at(-2))).size).toBe(40);
  });
});
