// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h, render } from 'preact';

vi.mock('../src/fabry/chat.js', () => ({
  loadChats: vi.fn(),
  openChat: vi.fn(),
  startNewChat: vi.fn(),
}));

import * as chat from '../src/fabry/chat.js';
import * as store from '../src/fabry/store.js';
import Sidebar from '../src/fabry/components/Sidebar.jsx';
import sidebarStyles from '../src/fabry/components/Sidebar.module.css';

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<Sidebar />, root);
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.chats.value = [
    {
      chat_id: 'chat_1',
      timestamp: 1760000000,
      message_count: 4,
      first_message: 'find failed exports',
      summary: 'Failed exports triage',
    },
    { chat_id: 'chat_2', timestamp: 1760000000, message_count: 1, first_message: 'hello' },
  ];
  store.chatsTotal.value = 10;
  store.activeChatId.value = 'chat_2';
  store.chatsLoading.value = false;
});

describe('Sidebar', () => {
  it('renders the Mr. Fabry brand title at the top', () => {
    const root = mount();
    expect(root.querySelector(`.${sidebarStyles.sidebarName}`)!.textContent).toBe('Mr. Fabry');
    expect(
      root.querySelector(`.${sidebarStyles.sidebarTitle} .${sidebarStyles.sidebarMark}`),
    ).toBeTruthy();
  });
  it('renders rows with title fallback chain, no time-ago meta, and marks the active one', () => {
    const root = mount();
    const rows = [...root.querySelectorAll(`.${sidebarStyles.chatRow}`)];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Failed exports triage'); // summary wins
    expect(rows[1].textContent).toContain('hello'); // first_message fallback
    expect(rows[1].classList.contains(sidebarStyles.active)).toBe(true);
    expect(root.querySelector('.fabry-chat-meta')).toBeNull(); // time-ago removed
  });
  it('has no chat search box', () => {
    expect(mount().querySelector('.fabry-search')).toBeNull();
  });
  it('clicking a row opens it; New chat resets', () => {
    const root = mount();
    root.querySelectorAll<HTMLElement>(`.${sidebarStyles.chatRow}`)[0].click();
    expect(chat.openChat).toHaveBeenCalledWith('chat_1');
    root.querySelector<HTMLElement>(`.${sidebarStyles.newchat}`)!.click();
    expect(chat.startNewChat).toHaveBeenCalled();
  });
});

describe('Sidebar — no collapse', () => {
  it('always renders expanded (no collapse toggle)', () => {
    const root = mount();
    expect(root.querySelector(`.${sidebarStyles.sidebar}.collapsed`)).toBeNull();
    expect(root.querySelector('.fabry-sidebar-toggle')).toBeNull();
    expect(root.querySelector(`.${sidebarStyles.chatlist}`)).toBeTruthy();
  });
});

describe('Sidebar — infinite scroll', () => {
  it('scrolling near the bottom loads older chats (no button)', () => {
    store.chatsTotal.value = 50; // more than loaded
    const root = mount();
    expect(root.querySelector('.fabry-loadmore')).toBeNull();
    root
      .querySelector(`.${sidebarStyles.chatlist}`)!
      .dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(chat.loadChats).toHaveBeenCalledWith({ more: true }); // jsdom zero-geometry = near-bottom
  });
  it('does not load while already loading or when everything is loaded', () => {
    store.chatsLoading.value = true;
    const root = mount();
    root
      .querySelector(`.${sidebarStyles.chatlist}`)!
      .dispatchEvent(new Event('scroll', { bubbles: true }));
    store.chatsLoading.value = false;
    store.chatsTotal.value = 2; // all loaded
    const root2 = mount();
    root2
      .querySelector(`.${sidebarStyles.chatlist}`)!
      .dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(chat.loadChats).not.toHaveBeenCalled();
  });
});

describe('Sidebar — resize', () => {
  it('dragging the edge resizes within clamps and persists on mouseup', () => {
    global.chrome = {
      storage: { local: { set: vi.fn(), get: vi.fn().mockResolvedValue({}) } } as any,
    } as any;
    store.sidebarWidth.value = 280;
    const root = mount();
    const handle = root.querySelector(`.${sidebarStyles.sideResizer}`);
    handle!.dispatchEvent(new MouseEvent('mousedown', { clientX: 300, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 380, bubbles: true }));
    expect(store.sidebarWidth.value).toBe(360);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, bubbles: true }));
    expect(store.sidebarWidth.value).toBe(420); // clamped
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ fabrySidebarWidth: 420 });
  });
});
