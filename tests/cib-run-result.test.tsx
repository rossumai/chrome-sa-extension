// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import RunResult, { runTitle } from '../src/cib/components/RunResult.jsx';
import type { RunView } from '../src/cib/components/RunResult.jsx';

let root: HTMLElement;
const mount = (run: RunView) => act(() => void render(<RunResult run={run} />, root));

const base: RunView = {
  mode: 'check',
  running: false,
  failed: false,
  status: 'Finished: blocked',
  clock: '',
  phases: {
    counts: { release: { done: 3, total: 3 }, checks: { done: 6, total: 6 } },
    current: 'checks',
  },
  outcome: null,
  log: '10:00:00 check CIB v2.1.0 into organization 123456\n',
  probeLeft: false,
  runId: 'cib-2026-10-30',
};
const blocked: RunView = {
  ...base,
  failed: true,
  outcome: {
    status: 'blocked',
    verdict: {
      tone: 'fail',
      text: 'Blocked: nothing was written. Fix the blockers, then run again.',
    },
    blockers: ['region prod-eu does not match the organization', 'Coupa rejected the credentials'],
    notes: ['einvoicing is not enabled for the organization group'],
    details: '{}',
  },
};
const done = (pending: number, probeLeft = false): RunView => ({
  ...base,
  mode: 'deploy',
  probeLeft,
  outcome: {
    status: 'done',
    verdict: { tone: pending ? 'warn' : 'ok', text: 'Deployed with open items: facts.' },
    notes: [],
    details: '{"status":"done"}',
    stats: { objects: 112, started: 5, invoked: 6, pending },
  },
});

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('RunResult', () => {
  it('a blocked check shows the headline in bold and both blockers verbatim', () => {
    mount(blocked);
    expect(root.querySelector('[data-verdict] b')!.textContent).toBe('Blocked');
    expect(root.textContent).toContain('region prod-eu does not match the organization');
    expect(root.textContent).toContain('Coupa rejected the credentials');
    expect(root.textContent).toContain('Notes, not blocking');
  });

  it('a finished deploy shows the three stats, the missing one as a warning', () => {
    mount(done(1));
    const stats = [...root.querySelectorAll<HTMLElement>('[data-stat]')];
    expect(stats.map((s) => s.dataset.stat)).toEqual(['objects', 'imports', 'missing']);
    expect(stats[1].textContent).toContain('5 / 6');
    expect(stats[2].getAttribute('data-warn')).toBe('true');
  });

  it('a check function left over adds a note only after a finished deploy', () => {
    mount(done(0, true));
    expect(root.textContent).toContain(
      'The Coupa check function is still deployed. Remove it in step 3.',
    );
    mount({ ...blocked, probeLeft: true });
    expect(root.textContent).not.toContain('The Coupa check function is still deployed');
  });

  it('while running, the current phase is now and there is no verdict', () => {
    mount({ ...base, running: true });
    expect(root.querySelector('[data-verdict]')).toBeNull();
    const states = [...root.querySelectorAll<HTMLElement>('[data-phase]')].map(
      (e) => e.dataset.state,
    );
    expect(states.slice(0, 3)).toEqual(['done', 'now', 'idle']);
  });

  it('the running detail is one fixed line with the full text on hover', () => {
    const detail =
      'rossumai/rossum-coupa-integration v2.1.0: cib/default/workspaces/x/queues/y/schema.json';
    mount({ ...base, running: true, detail });
    const el = root.querySelector<HTMLElement>('[data-detail]')!;
    expect(el.textContent).toBe(detail);
    expect(el.title).toBe(detail);
    // the line keeps its place before the first progress event too, so nothing below it moves
    mount({ ...base, running: true });
    expect(root.querySelector('[data-detail]')).not.toBeNull();
  });

  it('a run that threw says why in step 5, with how to continue', () => {
    const error = 'create engine_fields:7 failed: 400 {"name":["already exists"]}';
    const objects = { ...base.phases, current: 'objects' };
    mount({ ...base, mode: 'deploy', failed: true, error, phases: objects });
    const el = root.querySelector('[data-verdict]')!;
    expect(el.textContent).toContain('Stopped with an error');
    expect(el.textContent).toContain(error);
    expect(el.textContent).toContain('checkpoint cib-2026-10-30 keeps');
    mount({ ...base, failed: true, error });
    expect(root.querySelector('[data-verdict]')!.textContent).toContain('press Check only again');
  });

  it('the current phase segment fills by its progress; phases that did not run are marked', () => {
    mount({ ...base, running: true });
    // only the current segment carries a fill; Checks reported 6/6
    const filled = root.querySelectorAll<HTMLElement>('span[style]');
    expect(filled.length).toBe(1);
    expect(filled[0].style.getPropertyValue('--p')).toBe('100%');
    expect(root.querySelector('[data-phase="objects"]')!.getAttribute('data-state')).toBe('idle');
    mount(blocked);
    expect(root.querySelector('[data-phase="objects"]')!.getAttribute('data-state')).toBe('skip');
  });

  it("the log greys each line's time and copies the plain text", () => {
    mount(base);
    expect(root.querySelector('[data-log] pre span')!.textContent).toBe('10:00:00');
  });

  it('the log is always shown, not a collapsible block', () => {
    mount({ ...base, running: true });
    expect(root.querySelector('[data-log]')!.tagName).toBe('DIV');
    expect(root.querySelector('[data-log] pre')!.textContent).toBe(base.log);
  });

  it('the log summary counts lines in the singular for one', () => {
    mount(base);
    expect(root.querySelector('[data-log]')!.textContent).toContain('Log · 1 line');
    expect(root.querySelector('[data-log]')!.textContent).not.toContain('1 lines');
  });

  it('runTitle names the run', () => {
    expect(runTitle({ ...base, mode: 'deploy', running: true }, 'v2.1.0')).toBe(
      'Deploying CIB v2.1.0',
    );
    expect(runTitle(blocked, 'v2.1.0')).toBe('Check result');
    expect(runTitle(done(0), 'v2.1.0')).toBe('Deploy result');
    expect(runTitle({ ...base, mode: 'deploy', failed: true }, 'v2.1.0')).toBe('Deploy stopped');
  });
});
