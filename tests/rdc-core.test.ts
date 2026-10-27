import { describe, it, expect } from 'vitest';
import { answerFor, apiBaseOf, envInputFor } from '../src/rdc/core.js';
import { TARGET_ENV } from '../src/rdc/deploy.js';

const one = { results: [{ id: 42, name: 'Acme', organization_group: null }] };

describe('apiBaseOf', () => {
  it('is the origin plus /api/v1, the shape rdc stores as api_base', () => {
    expect(apiBaseOf('https://acme.rossum.app')).toBe('https://acme.rossum.app/api/v1');
    expect(apiBaseOf('https://acme.rossum.app/')).toBe('https://acme.rossum.app/api/v1');
    expect(apiBaseOf('http://localhost:3000')).toBe('http://localhost:3000/api/v1');
  });
  it('refuses anything that is not an http(s) origin', () => {
    expect(apiBaseOf('')).toBeNull();
    expect(apiBaseOf('acme.rossum.app')).toBeNull();
    expect(apiBaseOf('chrome-extension://abc')).toBeNull();
  });
});

describe('envInputFor', () => {
  it('builds a token env for the one listed organization', () => {
    expect(envInputFor('https://acme.rossum.app', 'tok', one, TARGET_ENV)).toEqual({
      name: TARGET_ENV,
      apiBase: 'https://acme.rossum.app/api/v1',
      orgId: 42,
      authKind: 'token',
      token: 'tok',
    });
  });
  it('refuses when the organization cannot be told', () => {
    const two = { results: [one.results[0], { id: 43, name: 'Other' }] };
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', two, TARGET_ENV)).toBe('string');
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', { results: [] }, TARGET_ENV)).toBe(
      'string',
    );
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', null, TARGET_ENV)).toBe('string');
    const noId = { results: [{ name: 'Acme' }] };
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', noId, TARGET_ENV)).toBe('string');
  });
  it('refuses a bad domain or a missing token', () => {
    expect(typeof envInputFor('nope', 'tok', one, TARGET_ENV)).toBe('string');
    expect(typeof envInputFor('https://acme.rossum.app', '', one, TARGET_ENV)).toBe('string');
  });
});

describe('answerFor', () => {
  const prompt = {
    kind: 'conflict',
    question: 'Which side?',
    choices: [
      { key: 'r', label: 'Use remote' },
      { key: 'l', label: 'Keep local' },
    ],
  };
  it('passes a listed choice through', () => {
    expect(answerFor(prompt, 'r')).toBe('r');
  });
  it('turns cancel or an unlisted key into no answer', () => {
    expect(answerFor(prompt, null)).toBeNull();
    expect(answerFor(prompt, 'x')).toBeNull();
  });
});
