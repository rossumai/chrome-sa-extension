// src/cib/view.ts
// Pure view decisions for the CIB deploy page: which phase is where, how a verdict reads, and which
// Coupa login panel fits. No DOM, no requests.
import type { Progress } from './engine.js';

// the engine's progress phases, in run order: [key, label, read-only]
export const PHASES: [key: string, label: string, readOnly: boolean][] = [
  ['release', 'Read the release', true],
  ['checks', 'Checks', true],
  ['objects', 'Create objects', false],
  ['patches', 'Secrets and hooks', false],
  ['memorisation', 'Memorisation collections', false],
  ['imports', 'Start Coupa imports', false],
  ['restore', 'Full first import', false],
  ['datasets', 'Wait for datasets', false],
];

export type PhaseLog = {
  counts: Record<string, { done: number; total: number }>;
  current: string | null;
};

export const trackPhase = (log: PhaseLog, p: Progress): PhaseLog => ({
  counts: { ...log.counts, [p.phase]: { done: p.done, total: p.total } },
  current: p.phase,
});

export type PhaseState = 'done' | 'now' | 'fail' | 'idle';

// a phase that reported is done, except the current one, which takes the run's end state; a phase
// that never reported (e.g. restore, which runs only after an earlier teardown) stays idle
export const phaseStates = (log: PhaseLog, end: 'running' | 'ok' | 'fail'): PhaseState[] =>
  PHASES.map(([k]) => {
    if (!(k in log.counts)) return 'idle';
    if (k !== log.current || end === 'ok') return 'done';
    return end === 'running' ? 'now' : 'fail';
  });

// verdict() texts read "Headline: the rest"
export const splitVerdict = (text: string): { head: string; rest: string } => {
  const i = text.indexOf(':');
  return i < 0
    ? { head: text, rest: '' }
    : { head: text.slice(0, i), rest: text.slice(i + 1).trim() };
};

export type LoginRoute = 'browser' | 'org';

// The route a run takes is fixed by the engine: the check function when one exists, else the
// browser. The radio only chooses what to show, so 'stale' says the function still wins.
export const loginPanel = (
  route: LoginRoute,
  probe: boolean,
): 'browser-ready' | 'create' | 'org-ready' | 'stale' =>
  route === 'org' ? (probe ? 'org-ready' : 'create') : probe ? 'stale' : 'browser-ready';
