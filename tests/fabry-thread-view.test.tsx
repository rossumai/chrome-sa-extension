// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h, render } from 'preact';

vi.mock('../src/fabry/chat.js', () => ({
  openChat: vi.fn(),
  sendMessage: vi.fn(),
  answerQuestions: vi.fn(),
}));

import * as chat from '../src/fabry/chat.js';
import * as store from '../src/fabry/store.js';
import Thread from '../src/fabry/components/Thread.jsx';
import noticeStyles from '../src/ui/fabry/FabryNotice.module.css';
import mdStyles from '../src/ui/fabry/FabryMarkdown.module.css';
import threadStyles from '../src/fabry/components/Thread.module.css';
import assistantTurnStyles from '../src/fabry/components/AssistantTurn.module.css';
import fabryQuestionsStyles from '../src/fabry/components/FabryQuestions.module.css';

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<Thread />, root);
  return root;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  store.activeChatId.value = 'chat_1';
  store.threadLoading.value = false;
  store.streaming.value = false;
  store.liveTurn.value = null;
  store.deepPhase.value = null;
  store.thread.value = [
    {
      role: 'user',
      chip: true,
      command: false,
      text: '/usage',
      images: [],
      feedback: null,
      reasoning: '',
      tools: [],
      interrupted: false,
    },
    {
      role: 'assistant',
      chip: false,
      command: false,
      text: 'Persona set.',
      images: [],
      feedback: null,
      reasoning: '',
      tools: [],
      interrupted: false,
    },
    {
      role: 'user',
      chip: false,
      command: false,
      text: '**q**',
      images: [],
      feedback: null,
      reasoning: '',
      tools: [],
      interrupted: false,
    },
    {
      role: 'assistant',
      chip: false,
      command: false,
      text: 'the **answer**',
      images: [],
      feedback: true,
      reasoning: 'thought hard',
      tools: ['rossum_get_queue'],
      interrupted: false,
    },
  ];
});

describe('Thread', () => {
  it('renders chips, user turns, assistant markdown, reasoning and tool chips', () => {
    const root = mount();
    expect(root.querySelector(`.${threadStyles.turnChip}`)!.textContent).toContain('/usage');
    expect(root.querySelectorAll(`.${threadStyles.turnUser}`).length).toBe(1); // chip is not a user bubble
    expect(
      root.querySelector(`.${assistantTurnStyles.turnAssistant} .` + mdStyles.md + ' strong')!
        .textContent,
    ).toBe('answer');
    expect(root.querySelector(`.${assistantTurnStyles.tools}`)!.textContent).toContain(
      'reading the queue',
    );
    expect(root.querySelector('.fabry-thinking')).toBeTruthy();
  });
  it('does not render 👍/👎 feedback buttons (hidden pending backend feedback-id fix), keeps Copy', () => {
    const root = mount();
    const turns = root.querySelectorAll(`.${assistantTurnStyles.turnAssistant}`);
    expect(turns[1].querySelector('.fabry-fb-up')).toBeNull();
    expect(turns[1].querySelector('.fabry-fb-down')).toBeNull();
    expect(turns[1].querySelector('.fabry-copy')).toBeTruthy();
  });
  it('renders the streaming live turn with a caret and the interrupted refresh row', () => {
    store.streaming.value = true;
    store.liveTurn.value = {
      reasoning: 'r',
      text: 'partial',
      tools: [],
      status: 'thinking',
      done: false,
    };
    const root = mount();
    expect(root.querySelector('.fabry-turn-live .' + mdStyles.caret)).toBeTruthy();
    store.streaming.value = false;
    store.liveTurn.value = null;
    store.thread.value = [
      ...store.thread.value,
      {
        role: 'assistant',
        chip: false,
        command: false,
        text: 'par',
        images: [],
        feedback: null,
        reasoning: '',
        tools: [],
        interrupted: true,
      },
    ];
    const root2 = mount();
    root2.querySelector<HTMLElement>(`.${assistantTurnStyles.refresh}`)!.click();
    expect(chat.openChat).toHaveBeenCalledWith('chat_1');
  });
  // The empty-new-chat greeting + starters moved to <Welcome> (App renders it
  // instead of Thread when empty) — covered by tests/fabry-welcome.test.js.
  it('shows the deep phase chip while verifying', () => {
    store.streaming.value = true;
    store.liveTurn.value = { reasoning: '', text: 'x', tools: [] };
    store.deepPhase.value = { phase: 'verify', round: 0 };
    const root = mount();
    expect(root.querySelector(`.${threadStyles.deepPhase}`)!.textContent).toContain(
      'Verifying in a fresh chat',
    );
    store.deepPhase.value = { phase: 'refine', round: 2 };
    const root2 = mount();
    expect(root2.querySelector(`.${threadStyles.deepPhase}`)!.textContent).toContain(
      'Refining 2/2',
    );
  });
  it('verdict chip renders per state and expands the critic strip', async () => {
    store.thread.value = [
      {
        role: 'user',
        chip: false,
        command: false,
        text: 'q',
        images: [],
        feedback: null,
        reasoning: '',
        tools: [],
        interrupted: false,
      },
      {
        role: 'assistant',
        chip: false,
        command: false,
        text: 'a',
        images: [],
        feedback: null,
        reasoning: '',
        tools: [],
        interrupted: false,
        deep: {
          verdict: 'fail',
          issues: ['wrong count'],
          criticText: 'VERDICT: FAIL\n- wrong count',
        },
      },
    ];
    const root = mount();
    const chipEl = root.querySelector<HTMLElement>(
      `.${assistantTurnStyles.deepChip}.${assistantTurnStyles.fail}`,
    )!;
    expect(chipEl.textContent).toContain('1 unresolved issue');
    chipEl.click();
    await flush();
    expect(root.querySelector(`.${assistantTurnStyles.deepStrip}`)!.textContent).toContain(
      'wrong count',
    );
  });
  it('renders a question form for a question turn and suppresses feedback', () => {
    store.thread.value = [
      {
        role: 'user',
        chip: false,
        command: false,
        text: 'draft',
        images: [],
        feedback: null,
        reasoning: '',
        tools: [],
        interrupted: false,
      },
      {
        role: 'assistant',
        chip: false,
        command: false,
        text: '',
        images: [],
        feedback: null,
        reasoning: '',
        tools: [],
        interrupted: false,
        questions: [{ question: 'Name?', options: [], multi_select: false }],
      },
    ];
    const root = mount();
    expect(root.querySelector(`.${fabryQuestionsStyles.q}`)).toBeTruthy();
    expect(root.querySelector(`.${assistantTurnStyles.turnFoot}`)).toBeNull(); // no feedback on a question turn
  });
  it('renders the unsupported-element notice for a text-less unknown turn', () => {
    store.thread.value = [
      {
        role: 'assistant',
        chip: false,
        command: false,
        text: '',
        images: [],
        feedback: null,
        reasoning: '',
        tools: [],
        interrupted: false,
        unhandled: [{ type: 'data-agent-confirmation', data: { prompt: 'ok?' } }],
      },
    ];
    const root = mount();
    expect(root.querySelector('.' + noticeStyles.warn)!.textContent).toContain(
      'data-agent-confirmation',
    );
    expect(root.querySelector(`.${assistantTurnStyles.turnFoot}`)).toBeNull();
  });
});
