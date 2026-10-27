import { describe, it, expect } from 'vitest';
import { ENV, answerFor, apiBaseOf, envInputFor, treeRows } from '../src/rdc/core.js';

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
    expect(envInputFor('https://acme.rossum.app', 'tok', one, ENV)).toEqual({
      name: ENV,
      apiBase: 'https://acme.rossum.app/api/v1',
      orgId: 42,
      authKind: 'token',
      token: 'tok',
    });
  });
  it('refuses when the organization cannot be told', () => {
    const two = { results: [one.results[0], { id: 43, name: 'Other' }] };
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', two, ENV)).toBe('string');
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', { results: [] }, ENV)).toBe(
      'string',
    );
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', null, ENV)).toBe('string');
    const noId = { results: [{ name: 'Acme' }] };
    expect(typeof envInputFor('https://acme.rossum.app', 'tok', noId, ENV)).toBe('string');
  });
  it('refuses a bad domain or a missing token', () => {
    expect(typeof envInputFor('nope', 'tok', one, ENV)).toBe('string');
    expect(typeof envInputFor('https://acme.rossum.app', '', one, ENV)).toBe('string');
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

describe('treeRows', () => {
  it('lists each directory once, before its contents, in path order', () => {
    const files = new Map<string, Uint8Array>([
      ['envs/org/queues/invoices.json', new Uint8Array(3)],
      ['rdc.toml', new Uint8Array(10)],
      ['envs/org/hooks/a.py', new Uint8Array(1)],
    ]);
    expect(treeRows(files)).toEqual([
      { key: 'envs/', depth: 0, name: 'envs', dir: true },
      { key: 'envs/org/', depth: 1, name: 'org', dir: true },
      { key: 'envs/org/hooks/', depth: 2, name: 'hooks', dir: true },
      { key: 'envs/org/hooks/a.py', depth: 3, name: 'a.py', dir: false, size: 1 },
      { key: 'envs/org/queues/', depth: 2, name: 'queues', dir: true },
      {
        key: 'envs/org/queues/invoices.json',
        depth: 3,
        name: 'invoices.json',
        dir: false,
        size: 3,
      },
      { key: 'rdc.toml', depth: 0, name: 'rdc.toml', dir: false, size: 10 },
    ]);
  });
  it('is empty for an empty tree', () => {
    expect(treeRows(new Map())).toEqual([]);
  });
});
