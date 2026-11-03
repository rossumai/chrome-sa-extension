// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import TargetStep from '../src/cib/components/TargetStep.jsx';
import CredentialsStep from '../src/cib/components/CredentialsStep.jsx';
import DeployStep from '../src/cib/components/DeployStep.jsx';
import CoupaLoginStep from '../src/cib/components/CoupaLoginStep.jsx';
import RunResult from '../src/cib/components/RunResult.jsx';
import type { Target } from '../src/cib/cib.js';
import type { RunView } from '../src/cib/components/RunResult.jsx';
import type { LoginRoute } from '../src/cib/view.js';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe('TargetStep data-help hooks', () => {
  it('has release, org, region and owner hooks', () => {
    const target: Target = { orgId: 123456, orgName: 'Acme Sandbox', region: 'prod-eu2' };
    act(
      () =>
        void render(
          <TargetStep
            release="v2.1.0"
            resumeRelease={null}
            runId="cib-2024-11-03"
            target={target}
            targetErrors={[]}
            query=""
            owner=""
            label=""
            owners={[]}
            state="current"
            onQuery={vi.fn()}
            onPick={vi.fn()}
          />,
          root,
        ),
    );
    expect(root.querySelectorAll('[data-help="release"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="org"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="region"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="owner"]').length).toBe(1);
  });

  it('shows "From checkpoint" when resumeRelease differs from release', () => {
    const target: Target = { orgId: 123456, orgName: 'Acme Sandbox', region: 'prod-eu2' };
    act(
      () =>
        void render(
          <TargetStep
            release="v2.1.0"
            resumeRelease="v2.0.0"
            runId="cib-2024-11-03"
            target={target}
            targetErrors={[]}
            query=""
            owner=""
            label=""
            owners={[]}
            state="current"
            onQuery={vi.fn()}
            onPick={vi.fn()}
          />,
          root,
        ),
    );
    expect(root.textContent).toContain('From checkpoint');
    expect(root.textContent).not.toContain('latest');
    const hint = root.querySelector('dd[title]') as HTMLElement;
    expect(hint?.title).toBe('Run cib-2024-11-03 was started with v2.0.0 and resumes with it');
  });
});

describe('CredentialsStep data-help hooks', () => {
  it('has coupa-url, client-secret and secret-note hooks', () => {
    act(
      () =>
        void render(
          <CredentialsStep
            coupaUrl=""
            coupaId=""
            coupaSecret=""
            onInput={vi.fn()}
            showSecret={false}
            onToggleSecret={vi.fn()}
            state="current"
          />,
          root,
        ),
    );
    expect(root.querySelectorAll('[data-help="coupa-url"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="client-secret"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="secret-note"]').length).toBe(1);
  });
});

describe('DeployStep data-help hooks', () => {
  it('has check, deploy and resume hooks', () => {
    const deployRef = { current: null };
    const resumeRef = { current: null };
    act(
      () =>
        void render(
          <DeployStep
            runId="abc"
            allow={false}
            onRunIdInput={vi.fn()}
            onAllowChange={vi.fn()}
            ready={true}
            busy={false}
            state="current"
            deployRef={deployRef}
            resumeRef={resumeRef}
          />,
          root,
        ),
    );
    expect(root.querySelectorAll('[data-help="check"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="deploy"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="resume"]').length).toBe(1);
  });
});

describe('CoupaLoginStep data-help hooks', () => {
  it('has route-browser and route-org hooks', () => {
    act(
      () =>
        void render(
          <CoupaLoginStep
            route="browser"
            probe={null}
            probePage={null}
            busy={false}
            onRoute={vi.fn()}
            onCreate={vi.fn()}
            onRemove={vi.fn()}
          />,
          root,
        ),
    );
    expect(root.querySelectorAll('[data-help="route-browser"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="route-org"]').length).toBe(1);
  });
});

describe('RunResult data-help hooks', () => {
  it('has verdict and phases hooks', () => {
    const run: RunView = {
      mode: 'check',
      running: false,
      failed: false,
      runId: 'abc',
      status: 'done',
      clock: '12:34:56',
      phases: {
        current: '',
        counts: {},
      },
      outcome: {
        status: 'done',
        verdict: { tone: 'ok', text: 'All checks passed' },
        notes: [],
        details: '{}',
      },
      log: '',
      probeLeft: false,
    };
    act(() => void render(<RunResult run={run} />, root));
    expect(root.querySelectorAll('[data-help="verdict"]').length).toBe(1);
    expect(root.querySelectorAll('[data-help="phases"]').length).toBe(1);
  });
});
