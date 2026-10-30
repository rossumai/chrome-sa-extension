// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import OwnerCombobox, { ownerLabel } from '../src/cib/components/OwnerCombobox.jsx';
import type { Owner } from '../src/cib/components/OwnerCombobox.jsx';

const owners: Owner[] = [
  { username: 'jnovak', name: 'Jana Novak', email: 'jana.novak@example.com' },
  { username: 'acme-integration', name: '', email: 'integration@example.com' },
];

let root: HTMLElement;
const mount = (props: Partial<Parameters<typeof OwnerCombobox>[0]> = {}) => {
  const all = {
    query: '',
    owner: '',
    label: '',
    owners,
    orgId: '123456',
    onQuery: vi.fn(),
    onPick: vi.fn(),
    ...props,
  };
  act(() => void render(<OwnerCombobox {...all} />, root));
  return all;
};
const input = () => root.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const key = (k: string) =>
  act(() => void input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('OwnerCombobox', () => {
  it('typing calls onQuery with the text', () => {
    const p = mount();
    act(() => {
      input().value = 'jan';
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(p.onQuery).toHaveBeenCalledWith('jan');
  });

  it('ArrowDown then Enter picks the first owner', () => {
    const p = mount();
    act(() => input().focus());
    key('ArrowDown');
    key('Enter');
    expect(p.onPick).toHaveBeenCalledWith(owners[0]);
  });

  it('a mouse pick calls onPick and closes the list', () => {
    const p = mount();
    act(() => input().focus());
    const opt = root.querySelectorAll<HTMLElement>('[role="option"]')[1];
    act(() => void opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(p.onPick).toHaveBeenCalledWith(owners[1]);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('after a pick and blur the input shows the label', () => {
    mount({ query: 'jan', owner: 'jnovak', label: 'jnovak · Jana Novak' });
    act(() => input().focus());
    act(() => input().blur());
    expect(input().value).toBe('jnovak · Jana Novak');
  });

  it('while focused the input keeps the typed query even if owner is set', () => {
    mount({ query: 'jan', owner: 'jnovak', label: 'jnovak · Jana Novak' });
    act(() => input().focus());
    expect(input().value).toBe('jan');
  });

  it('empty owners shows the no-match text', () => {
    mount({ owners: [] });
    act(() => input().focus());
    expect(root.textContent).toContain(
      'No active admin matches. The hooks need an admin of this organization.',
    );
  });

  it('the hint names the organization', () => {
    mount();
    expect(root.textContent).toContain(
      'The CIB hooks run as this user. Only active admins of organization 123456 are listed.',
    );
  });

  it('ownerLabel joins username and name, or gives the username alone', () => {
    expect(ownerLabel(owners[0])).toBe('jnovak · Jana Novak');
    expect(ownerLabel(owners[1])).toBe('acme-integration');
  });
});
