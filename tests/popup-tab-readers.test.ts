// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readAuthInfo,
  readCurrentContext,
  readPageFlag,
  togglePageFlag,
  readOrgCache,
} from '../src/popup/tab-readers.js';
import { orgCacheKey } from '../src/rossum/orgName.js';

describe('popup tab-readers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("readOrgCache returns the entry for the tab's CURRENT token only", () => {
    window.localStorage.setItem('secureToken', 'tok-new');
    window.sessionStorage.setItem('other', 'x');
    // An entry another token left behind (an org switch whose new load failed).
    window.sessionStorage.setItem('rossum-sa-extension-org:00000000', '{"at":0}');
    expect(readOrgCache('rossum-sa-extension-org:')).toBeNull();
    window.sessionStorage.setItem(orgCacheKey('tok-new'), '{"at":1}');
    expect(readOrgCache('rossum-sa-extension-org:')).toBe('{"at":1}');
  });

  it('readOrgCache returns null without a token', () => {
    window.sessionStorage.setItem(orgCacheKey('tok'), '{"at":1}');
    expect(readOrgCache('rossum-sa-extension-org:')).toBeNull();
  });

  it('readOrgCache returns null without an entry', () => {
    expect(readOrgCache('rossum-sa-extension-org:')).toBeNull();
  });

  it('readAuthInfo returns secureToken and origin', () => {
    window.localStorage.setItem('secureToken', 'xyz');
    const info = readAuthInfo();
    expect(info.token).toBe('xyz');
    expect(info.domain).toBe(window.location.origin);
  });

  it('readAuthInfo returns null token when not set', () => {
    expect(readAuthInfo().token).toBeNull();
  });

  it('readPageFlag reports false by default', () => {
    expect(readPageFlag('devFeaturesEnabled')).toBe(false);
  });

  it('togglePageFlag flips the flag on and off, independently per key', () => {
    togglePageFlag('devFeaturesEnabled');
    expect(window.localStorage.getItem('devFeaturesEnabled')).toBe('true');
    expect(readPageFlag('devFeaturesEnabled')).toBe(true);

    // Toggling devDebugEnabled must not affect devFeaturesEnabled.
    togglePageFlag('devDebugEnabled');
    expect(readPageFlag('devDebugEnabled')).toBe(true);
    expect(readPageFlag('devFeaturesEnabled')).toBe(true);

    togglePageFlag('devFeaturesEnabled');
    expect(window.localStorage.getItem('devFeaturesEnabled')).toBeNull();
    expect(readPageFlag('devFeaturesEnabled')).toBe(false);
    expect(readPageFlag('devDebugEnabled')).toBe(true);
  });

  it('readCurrentContext extracts annotationId from /document/ paths', () => {
    history.replaceState(null, '', '/document/12345');
    const ctx = readCurrentContext();
    expect(ctx.annotationId).toBe('12345');
    expect(ctx.queueId).toBeNull();
  });

  it('readCurrentContext extracts annotationId from /annotations/ paths', () => {
    history.replaceState(null, '', '/annotations/9876');
    expect(readCurrentContext().annotationId).toBe('9876');
  });

  it('readCurrentContext extracts queueId from /queues/ paths', () => {
    history.replaceState(null, '', '/queues/42');
    const ctx = readCurrentContext();
    expect(ctx.queueId).toBe('42');
    expect(ctx.annotationId).toBeNull();
  });

  it('readCurrentContext returns nulls when path matches nothing', () => {
    history.replaceState(null, '', '/');
    const ctx = readCurrentContext();
    expect(ctx.annotationId).toBeNull();
    expect(ctx.queueId).toBeNull();
    expect(ctx.domain).toBe(window.location.origin);
  });
});
