import { describe, it, expect } from 'vitest';
import {
  canonicalString,
  formatCode,
  mintCode,
  renderReceipt,
  parseReceipt,
  verifyReceipt,
  RECEIPT_HEADER,
  type ReceiptFields,
} from '../src/training/receipt.js';
import { hmacSha256 } from '../src/training/hmac.js';

const sign = (m: string) => hmacSha256('test-key', m);
const FIELDS: ReceiptFields = {
  trackId: 'acme-ap',
  trackVersion: 1,
  host: 'x.rossum.app',
  userId: 42,
  username: 'jan.novak@example.com',
  queueId: 31927,
  hookId: 48211,
  ruleId: 9031,
  annotationId: 7712045,
  dateUtc: '2026-11-13',
};

describe('receipt v2', () => {
  it('signs every printed field, the built ids included', () => {
    expect(canonicalString(FIELDS)).toBe(
      'RSAT2|acme-ap@1|x.rossum.app|42|jan.novak@example.com|q31927,h48211,r9031,a7712045|2026-11-13',
    );
  });

  it('formats a 60-bit Crockford code with the RSA2 prefix', () => {
    const code = formatCode(new Uint8Array(32));
    expect(code).toBe('RSA2-0000-0000-0000');
  });

  it('round-trips through render and parse', async () => {
    const code = await mintCode(FIELDS, sign);
    const text = renderReceipt(FIELDS, code);
    expect(text.startsWith(RECEIPT_HEADER)).toBe(true);
    expect(parseReceipt(text)).toEqual({ fields: FIELDS, code });
    expect(await verifyReceipt(text, sign)).toEqual({ valid: true, fields: FIELDS });
  });

  it('rejects a summary whose user, org or any id was changed', async () => {
    const text = renderReceipt(FIELDS, await mintCode(FIELDS, sign));
    for (const [from, to] of [
      ['jan.novak@example.com', 'someone@example.com'],
      ['x.rossum.app', 'y.rossum.app'],
      ['| 48211', '| 48212'],
      ['| 7712045', '| 7712046'],
    ]) {
      expect((await verifyReceipt(text.replace(from, to), sign)).valid).toBe(false);
    }
  });

  it('does not parse a summary with a missing or non-numeric id', async () => {
    const text = renderReceipt(FIELDS, await mintCode(FIELDS, sign));
    expect(parseReceipt(text.replace('| 9031', '| ninety'))).toBeNull();
    expect(parseReceipt(text.replace(/^rule.*$/m, ''))).toBeNull();
    expect(parseReceipt('ROSSUM PARTNER ONBOARDING — COMPLETION RECEIPT')).toBeNull();
  });
});
