// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h, render } from 'preact';

vi.mock('../src/fabry/chat.js', () => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  stopStreaming: vi.fn(),
}));

import * as chat from '../src/fabry/chat.js';
import * as store from '../src/fabry/store.js';
import Welcome from '../src/fabry/components/Welcome.jsx';
import welcomeStyles from '../src/fabry/components/Welcome.module.css';
import composerStyles from '../src/fabry/components/Composer.module.css';

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<Welcome />, root);
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.streaming.value = false;
  store.activeChatId.value = null;
  store.commands.value = [];
  store.deepVerifyAllowed.value = true;
  store.sendError.value = null;
});

describe('Welcome (centered empty state)', () => {
  it('renders the greeting, the composer, and starter pills', () => {
    const root = mount();
    expect(root.querySelector(`.${welcomeStyles.welcomeTitle}`)!.textContent).toMatch(/explore/i);
    expect(
      root.querySelector(`.${composerStyles.composerBox} textarea.${composerStyles.input}`),
    ).toBeTruthy(); // the composer is the hero
    const pills = [...root.querySelectorAll(`.${welcomeStyles.welcomePill}`)];
    expect(pills.length).toBe(4);
    expect(pills[0].textContent).toContain('Map this organization');
  });
  it('clicking a starter pill sends its full prompt', () => {
    const root = mount();
    root.querySelector<HTMLElement>(`.${welcomeStyles.welcomePill}`)!.click();
    expect(chat.sendMessage).toHaveBeenCalledWith(
      expect.stringMatching(/overview of this organization/),
    );
  });
});
