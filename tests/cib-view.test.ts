import { test, expect } from 'vitest';
import {
  PHASES,
  trackPhase,
  phaseStates,
  phasePercent,
  stopNote,
  splitVerdict,
  loginPanel,
} from '../src/cib/view.js';
import type { PhaseLog } from '../src/cib/view.js';

test('PHASES lists the engine phases in run order', () => {
  expect(PHASES.map(([k]) => k)).toEqual([
    'release',
    'checks',
    'objects',
    'patches',
    'memorisation',
    'imports',
    'restore',
    'datasets',
  ]);
});

test('trackPhase keeps the last count of every phase and moves current', () => {
  let l: PhaseLog = { counts: {}, current: null };
  l = trackPhase(l, { phase: 'release', done: 3, total: 3 });
  l = trackPhase(l, { phase: 'objects', done: 5, total: 9 });
  expect(l.counts).toEqual({ release: { done: 3, total: 3 }, objects: { done: 5, total: 9 } });
  expect(l.current).toBe('objects');
});

test('phaseStates: earlier reported = done, current by end, unreported = idle or skipped', () => {
  const l: PhaseLog = {
    counts: { release: { done: 1, total: 1 }, checks: { done: 0, total: 6 } },
    current: 'checks',
  };
  expect(phaseStates(l, 'running').slice(0, 3)).toEqual(['done', 'now', 'idle']);
  expect(phaseStates(l, 'fail')[1]).toBe('fail');
  expect(phaseStates(l, 'ok')[1]).toBe('done');
  // unreported phases wait while the run goes on, and did not run once it ended
  expect(phaseStates(l, 'running')[6]).toBe('idle');
  expect(phaseStates(l, 'ok')[6]).toBe('skip'); // restore never reported
  expect(phaseStates(l, 'fail').slice(2)).toEqual(Array(6).fill('skip'));
});

test('phasePercent: done over total, 0 without a total', () => {
  expect(phasePercent({ done: 63, total: 112 })).toBe(56);
  expect(phasePercent({ done: 0, total: 0 })).toBe(0);
  expect(phasePercent(undefined)).toBe(0);
});

test('stopNote: what a run that threw left behind', () => {
  expect(stopNote('check', 'checks', 'r1')).toContain('Check only writes nothing');
  expect(stopNote('deploy', 'checks', 'r1')).toContain('Nothing was written');
  expect(stopNote('deploy', null, 'r1')).toContain('Nothing was written');
  expect(stopNote('deploy', 'objects', 'r1')).toContain('checkpoint r1 keeps');
});

test('splitVerdict splits at the first colon', () => {
  expect(splitVerdict('Blocked: nothing was written. Fix: x')).toEqual({
    head: 'Blocked',
    rest: 'nothing was written. Fix: x',
  });
  expect(splitVerdict('No colon')).toEqual({ head: 'No colon', rest: '' });
});

test('loginPanel covers the four route × probe cases', () => {
  expect(loginPanel('browser', false)).toBe('browser-ready');
  expect(loginPanel('org', false)).toBe('create');
  expect(loginPanel('org', true)).toBe('org-ready');
  expect(loginPanel('browser', true)).toBe('stale');
});
