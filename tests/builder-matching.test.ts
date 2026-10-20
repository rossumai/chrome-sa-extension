import { describe, it, expect } from 'vitest';
import { hookFieldRefs, hookRoles, hooksByField, mdhHooks } from '../src/builder/matching.js';

const vendorHook = {
  id: 7,
  name: 'Vendor matching',
  settings: {
    configurations: [
      {
        name: 'vendor by VAT',
        source: {
          dataset: 'vendors',
          queries: [{ find: { vat_id: '{sender_vat_id}', name: '{ sender_name | lower }' } }],
        },
        mapping: { dataset_key: 'id', target_schema_id: 'vendor_match' },
        additional_mappings: [{ dataset_key: 'iban', target_schema_id: 'vendor_iban' }],
        action_condition: '{document_type} == "invoice"',
      },
    ],
  },
};
const legacyHook = {
  id: 8,
  name: 'PO (legacy key)',
  settings: {
    configs: [
      {
        source: { queries: [{ find: { po: '{po_number}' } }] },
        mapping: { target_schema_id: 'po_match' },
      },
    ],
  },
};
const otherHook = { id: 9, name: 'Export', settings: { export_configs: [] } };

describe('mdhHooks', () => {
  it('keeps hooks whose configurations have queries (modern or legacy key)', () => {
    expect(mdhHooks([vendorHook, legacyHook, otherHook]).map((h) => h.id)).toEqual([7, 8]);
  });
});

describe('hookFieldRefs', () => {
  it('inputs are query and condition placeholders; outputs are mapping targets', () => {
    const r = hookFieldRefs(vendorHook);
    expect([...r.inputs].sort()).toEqual(['document_type', 'sender_name', 'sender_vat_id']);
    expect([...r.outputs].sort()).toEqual(['vendor_iban', 'vendor_match']);
  });

  it('reads a hook whose settings are being edited (not yet saved)', () => {
    const r = hookFieldRefs({
      settings: { configurations: [{ mapping: { target_schema_id: 'x' } }] },
    });
    expect([...r.outputs]).toEqual(['x']);
  });
});

describe('hooksByField', () => {
  it('lists, per field, the MDH hooks that use it and how', () => {
    const m = hooksByField([vendorHook, legacyHook]);
    expect(m.get('sender_vat_id')!.map((x) => [x.hook.id, x.role])).toEqual([[7, 'in']]);
    expect(m.get('vendor_match')!.map((x) => [x.hook.id, x.role])).toEqual([[7, 'out']]);
    expect(m.get('po_number')!.map((x) => x.hook.id)).toEqual([8]);
    expect(hookRoles({ inputs: new Set(['a']), outputs: new Set(['a', 'b']) })).toEqual(
      new Map([
        ['a', 'both'],
        ['b', 'out'],
      ]),
    );
  });
});
