// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys } from '../src/builder/model.js';
import { initHistory } from '../src/builder/history.js';

vi.mock('../src/builder/api.js', () => ({
  getSchema: vi.fn(),
  validateSchema: vi.fn(),
  patchSchema: vi.fn(),
}));
import * as api from '../src/builder/api.js';
import { openQueue, save } from '../src/builder/index.jsx';

const section = (id: string) => [{ category: 'section', id, label: id, children: [] }];

beforeEach(() => {
  vi.mocked(api.getSchema).mockReset();
  store.queues.value = [
    { id: 1, name: 'A', schema: 'https://x/api/v1/schemas/11' },
    { id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' },
  ];
  store.base.value = [];
  store.history.value = initHistory([]);
  store.generalErrors.value = [];
});

describe('openQueue', () => {
  it('ignores a schema response that arrives after a newer queue was opened', async () => {
    let releaseA: (v: any) => void = () => {};
    vi.mocked(api.getSchema).mockImplementation((id: number) =>
      id === 11
        ? new Promise((r) => (releaseA = r))
        : Promise.resolve({ id: 22, content: section('b_section') }),
    );
    const a = openQueue(1);
    await openQueue(2);
    releaseA({ id: 11, content: section('a_section') });
    await a;
    expect(store.selectedQueueId.value).toBe(2);
    expect(store.schema.value.id).toBe(22);
  });
});

describe('save', () => {
  it('shows landed-diff warnings in the banner', async () => {
    const content = section('s');
    store.schema.value = { id: 7, modified_at: 't0', content };
    const keyed = withKeys(content);
    store.base.value = keyed;
    store.history.value = initHistory(keyed);
    vi.mocked(api.getSchema)
      .mockResolvedValueOnce({ id: 7, modified_at: 't0', content })
      .mockResolvedValueOnce({
        id: 7,
        modified_at: 't1',
        content: [{ ...content[0], label: 'X' }],
      });
    vi.mocked(api.validateSchema).mockResolvedValue({});
    vi.mocked(api.patchSchema).mockResolvedValue({});
    await save();
    expect(store.generalErrors.value.join(' ')).toContain('[0].label');
  });
});
