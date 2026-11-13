// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tabPlace, recentOrigins, relativeTime, rowForKey, hostOf } from '../src/popup/offSite.js';

const HOST = 'https://acme.rossum.app';

describe('tabPlace', () => {
  it('names a document by its annotation id', () => {
    expect(tabPlace(`${HOST}/document/9104377`)).toBe('Document 9104377');
  });
  it('names a queue by its id', () => {
    expect(tabPlace(`${HOST}/queues/3311/all`)).toBe('Queue 3311');
  });
  it('names the settings', () => {
    expect(tabPlace(`${HOST}/settings/extensions`)).toBe('Settings');
  });
  it('names nothing else', () => {
    expect(tabPlace(`${HOST}/documents`)).toBeNull();
    expect(tabPlace('not a url')).toBeNull();
  });
});

describe('recentOrigins', () => {
  it('keeps each origin once, at its newest visit, in list order', () => {
    const viewed = [
      { id: '1', origin: 'https://a', at: 3 },
      { id: '2', origin: 'https://b', at: 2 },
      { id: '3', origin: 'https://a', at: 1 },
    ];
    expect(recentOrigins(viewed)).toEqual([
      { origin: 'https://a', at: 3 },
      { origin: 'https://b', at: 2 },
    ]);
  });
  it('ignores what is not a list, and malformed entries', () => {
    expect(recentOrigins(null)).toEqual([]);
    expect(recentOrigins([null, { origin: 5, at: 1 }, { origin: 'https://c' }])).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 10, 13, 12);
  it('words recent times', () => {
    expect(relativeTime(now - 20e3, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60e3, now)).toBe('5 min ago');
    expect(relativeTime(now - 2 * 3600e3, now)).toBe('2 h ago');
    expect(relativeTime(now - 30 * 3600e3, now)).toBe('yesterday');
    expect(relativeTime(now - 3 * 86400e3, now)).toBe('3 d ago');
  });
});

describe('rowForKey', () => {
  it('maps Enter to the first row and digits to their row', () => {
    expect(rowForKey({ key: 'Enter' }, 3)).toBe(0);
    expect(rowForKey({ key: '3' }, 3)).toBe(2);
  });
  it('ignores a digit past the list, an empty list and modifiers', () => {
    expect(rowForKey({ key: '4' }, 3)).toBeNull();
    expect(rowForKey({ key: 'Enter' }, 0)).toBeNull();
    expect(rowForKey({ key: '0' }, 3)).toBeNull();
    expect(rowForKey({ key: '1', metaKey: true }, 3)).toBeNull();
    expect(rowForKey({ key: 'a' }, 3)).toBeNull();
  });
  it('leaves Enter on a focused button or link to that control', () => {
    expect(rowForKey({ key: 'Enter', target: document.createElement('button') }, 3)).toBeNull();
    expect(rowForKey({ key: 'Enter', target: document.createElement('a') }, 3)).toBeNull();
    expect(rowForKey({ key: '2', target: document.createElement('button') }, 3)).toBe(1);
    expect(rowForKey({ key: 'Enter', target: document.body }, 3)).toBe(0);
  });
  it('ignores digits typed into an input', () => {
    expect(rowForKey({ key: '1', target: document.createElement('input') }, 3)).toBeNull();
    expect(rowForKey({ key: '1', target: document.createElement('textarea') }, 3)).toBeNull();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(rowForKey({ key: 'Enter', target: editable }, 3)).toBeNull();
  });
});

describe('hostOf', () => {
  it('keeps the host, and reads junk as empty', () => {
    expect(hostOf('https://acme.rossum.app/document/1')).toBe('acme.rossum.app');
    expect(hostOf('nope')).toBe('');
  });
});
