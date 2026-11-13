// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import Write from '../src/rdc/components/Write.jsx';
import { cliFor, planBlock } from '../src/rdc/components/Plan.jsx';
import { DEFAULT_PLAN } from '../src/rdc/plan.js';

let root: HTMLElement;
const mount = (el: any) => act(() => void render(el, root));
const flush = () => act(async () => {});
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush();
};
const byText = (text: string) =>
  [...root.querySelectorAll<HTMLElement>('button')].find((e) => e.textContent?.trim() === text)!;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const source = {
  name: 'test',
  domain: 'https://partner-sandbox.rossum.app',
  orgId: 5,
  orgName: 'T',
};
const props = (project: any, over: any = {}) => ({
  project,
  source,
  targetName: 'Acme',
  choice: DEFAULT_PLAN,
  dataStorage: vi.fn(async () => ({})),
  onWritten: vi.fn(),
  onTreeChanged: vi.fn(),
  directEdits: [],
  plan: { items: [], recovered: [], problems: [] },
  onBack: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});
const confirm = () =>
  act(() => {
    const el = root.querySelector<HTMLInputElement>('[aria-label="Type Acme to confirm"]')!;
    el.value = 'Acme';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const project = (sync: any) => ({
  files: vi.fn(() => new Map()),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  migrate: vi.fn(async () => ({})),
  sync: vi.fn(sync),
});

describe('Write', () => {
  it("explains a Web Lock refusal, keeps rdc's words, and reports nothing written", async () => {
    const p = props(
      project(async () => {
        throw new Error("env 'target' is already being synced in another tab");
      }),
    );
    mount(<Write {...p} />);
    confirm();
    act(() => byText('Write the changes to Acme').click());
    await settle();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Another tab of this browser');
    expect(alert.textContent).toContain('already being synced in another tab');
    expect(p.onWritten).not.toHaveBeenCalled();
  });

  it('titles the recovery prompt and shows its full question', async () => {
    const pj = project(async (_e: string, _o: unknown, ask: any) => {
      await ask({
        kind: 'recoverCreate',
        question:
          "labels/hold: an unfinished run's create may have made any of 2 labels (ids 5, 7). Which one did it create?",
        choices: [
          { key: '1', label: 'it is id 5' },
          { key: 'a', label: 'abort the sync' },
        ],
      });
      return {
        itemsPushed: 0,
        itemsPulled: 0,
        conflicts: 0,
        remoteDeletesResolved: 0,
        fileCount: 0,
      };
    });
    mount(<Write {...props(pj)} />);
    confirm();
    act(() => byText('Write the changes to Acme').click());
    await settle();
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('A deployment stopped in the middle');
    expect(dialog.textContent).toContain('Which one did it create?');
    act(() => byText('it is id 5').click());
    await flush();
  });
});

describe('Plan helpers', () => {
  it('cannot plan without migrate, or without the state kept in the org', () => {
    expect(planBlock(null, true)).toMatch(/cannot plan/);
    expect(planBlock({} as any, true)).toMatch(/cannot plan/);
    expect(planBlock({ migrate: () => 0 } as any, false)).toMatch(/cannot keep its sync state/);
    expect(planBlock({ migrate: () => 0 } as any, true)).toBe('');
  });
  it('shows the CLI equivalent with the chosen flags', () => {
    expect(
      cliFor({
        mirror: true,
        carry: { scoreThresholds: true, emailPrefixes: false, automation: false },
      }).at(-1),
    ).toBe('rdc migrate source target --mirror --carry scoreThresholds --dry-run');
  });
});
