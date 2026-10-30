import { describe, it, expect } from 'vitest';
import { parseReplyObject } from '../src/builder/assist.js';

const errors = { none: 'none', invalid: 'invalid' };

describe('parseReplyObject', () => {
  it('reads a fenced block', () => {
    expect(parseReplyObject('Here:\n```json\n{"a": 1}\n```\nDone.', errors)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('takes the first whole object, not up to the last brace in the prose', () => {
    expect(parseReplyObject('Sure: {"a": "}"} and {b}', errors)).toEqual({
      ok: true,
      value: { a: '}' },
    });
  });

  it('refuses a bare array instead of taking its first element', () => {
    expect(parseReplyObject('[{"a": 1}]', errors)).toEqual({ ok: false, error: 'none' });
  });

  it('tells no JSON from invalid JSON', () => {
    expect(parseReplyObject('No idea.', errors)).toEqual({ ok: false, error: 'none' });
    expect(parseReplyObject('{"a": }', errors)).toEqual({ ok: false, error: 'invalid' });
  });
});
