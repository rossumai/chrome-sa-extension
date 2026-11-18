import { describe, it, expect } from 'vitest';
import { TRACK } from '../src/training/track.js';
import {
  emptyProgress,
  recordResults,
  taskState,
  missionStatus,
  currentMission,
  currentTask,
  isTrackComplete,
  checkedCount,
  reachedMissions,
  migrate,
} from '../src/training/progress.js';
import { okAssertion, noAssertion, progressThrough } from './support/training.js';

describe('recordResults', () => {
  it('stores the latest result and reports a task that just became complete', () => {
    const p = emptyProgress(TRACK, 'barge-17', 1);
    const one = recordResults(p, { 'kickoff.queue': [okAssertion()] }, { queueId: 7 }, 10);
    expect(one.newlyPassed).toEqual(['kickoff.queue']);
    expect(one.progress.build).toEqual({ queueId: 7 });
    const two = recordResults(one.progress, { 'kickoff.queue': [okAssertion()] }, {}, 20);
    expect(two.newlyPassed).toEqual([]);
    expect(p.results).toEqual({}); // the input is not mutated
  });

  it('makes undone work incomplete again: complete or not, nothing in between', () => {
    const undone = recordResults(
      progressThrough(3),
      { 'kickoff.queue': [noAssertion()] },
      {},
      30,
    ).progress;
    expect(taskState(undone, 'kickoff.queue')).toBe('open');
    expect(missionStatus(TRACK, undone, 'kickoff')).toBe('active');
    // Missions whose own tasks pass stay done; the next incomplete one waits for the fix.
    expect(missionStatus(TRACK, undone, 'fields')).toBe('done');
    expect(missionStatus(TRACK, undone, 'matching')).toBe('locked');
    expect(currentTask(TRACK, undone)).toMatchObject({ mission: { id: 'kickoff' }, index: 0 });
    const fixed = recordResults(undone, { 'kickoff.queue': [okAssertion()] }, {}, 40);
    expect(fixed.newlyPassed).toEqual(['kickoff.queue']);
    expect(missionStatus(TRACK, fixed.progress, 'vendors')).toBe('done');
  });
});

describe('the unlock rule', () => {
  it('opens one mission at a time', () => {
    const p = progressThrough(2);
    expect(TRACK.missions.map((m) => missionStatus(TRACK, p, m.id))).toEqual([
      'done',
      'done',
      'active',
      'locked',
      'locked',
      'locked',
    ]);
    expect(currentMission(TRACK, p)!.id).toBe('vendors');
  });

  it('points at the first task of the current mission that does not pass now', () => {
    const p = recordResults(
      progressThrough(2),
      { 'vendors.dataset': [okAssertion()] },
      {},
      1,
    ).progress;
    expect(currentTask(TRACK, p)).toMatchObject({ index: 1, task: { id: 'vendors.records' } });
  });

  it('re-checks every mission up to the current one', () => {
    expect(reachedMissions(TRACK, progressThrough(2)).map((m) => m.id)).toEqual([
      'kickoff',
      'fields',
      'vendors',
    ]);
  });

  it('stays on the last mission once everything is done', () => {
    const p = progressThrough(6);
    expect(currentMission(TRACK, p)!.id).toBe('golive');
    expect(currentTask(TRACK, p)).toBeNull();
  });

  it('counts the tasks complete now', () => {
    expect(checkedCount(TRACK, progressThrough(1))).toEqual({ done: 1, total: 12 });
  });
});

describe('migrate', () => {
  it('drops another track entirely', () => {
    expect(migrate(TRACK, { ...progressThrough(1), trackId: 'partner-foundations' })).toBeNull();
  });

  it('drops unknown task ids and an issued receipt on a version change', () => {
    const p = { ...progressThrough(1), trackVersion: 0, receipt: { text: 'x', issuedAt: 1 } };
    p.results.gone = { at: 1, assertions: [okAssertion()] };
    const next = migrate(TRACK, p)!;
    expect(next.trackVersion).toBe(TRACK.version);
    expect(next.results.gone).toBeUndefined();
    expect(next.results['kickoff.queue']).toBeTruthy();
    expect(next.receipt).toBeNull();
  });
});
