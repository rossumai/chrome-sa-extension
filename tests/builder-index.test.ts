// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys } from '../src/builder/model.js';

vi.mock('../src/builder/api.js', () => ({
  getSchema: vi.fn(),
  validateSchema: vi.fn(),
  patchSchema: vi.fn(),
  getAnnotationContent: vi.fn(),
}));
import * as api from '../src/builder/api.js';
import {
  openQueue,
  save,
  pickAnnotation,
  renameSchema,
  undoChange,
} from '../src/builder/index.jsx';

const section = (id: string) => [{ category: 'section', id, label: id, children: [] }];

beforeEach(() => {
  vi.mocked(api.getSchema).mockReset();
  store.queues.value = [
    { id: 1, name: 'A', schema: 'https://x/api/v1/schemas/11' },
    { id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' },
  ];
  store.startDraft('', []);
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
    store.startDraft('Invoices', withKeys(content));
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

describe('pickAnnotation', () => {
  it('reads the id out of a pasted Rossum URL and loads its values', async () => {
    vi.mocked(api.getAnnotationContent).mockResolvedValue({
      content: [{ category: 'datapoint', schema_id: 'doc_id', content: { value: 'INV-9' } }],
    });
    await pickAnnotation('https://example.rossum.app/document/4242');
    expect(api.getAnnotationContent).toHaveBeenCalledWith(4242);
    expect(store.annotationId.value).toBe(4242);
    expect(store.values.value!.values.get('doc_id')).toEqual(['INV-9']);
  });

  it('rejects input that is not an annotation id or URL', async () => {
    vi.mocked(api.getAnnotationContent).mockClear();
    await pickAnnotation('hello');
    expect(store.annotationError.value).toBe('Not an annotation ID or URL');
    expect(api.getAnnotationContent).not.toHaveBeenCalled();
  });
});

describe('renameSchema', () => {
  it('stages the name as one undoable edit, and Save updates the schema list', async () => {
    const content = section('s');
    store.schema.value = { id: 7, name: 'Invoices', modified_at: 't0', content };
    store.schemas.value = [{ id: 7, url: 'https://x/api/v1/schemas/7', name: 'Invoices' }];
    store.startDraft('Invoices', withKeys(content));
    renameSchema('Invoices v2');
    expect(store.draftName.value).toBe('Invoices v2');
    expect(store.dirty.value).toBe(true);
    undoChange();
    expect(store.draftName.value).toBe('Invoices');
    expect(store.dirty.value).toBe(false);
    renameSchema('Invoices v2');
    vi.mocked(api.getSchema)
      .mockResolvedValueOnce({ id: 7, name: 'Invoices', modified_at: 't0', content })
      .mockResolvedValueOnce({ id: 7, name: 'Invoices v2', modified_at: 't1', content });
    vi.mocked(api.validateSchema).mockResolvedValue({});
    vi.mocked(api.patchSchema).mockResolvedValue({});
    await save();
    expect(api.patchSchema).toHaveBeenLastCalledWith(7, content, 'Invoices v2');
    expect(store.schemas.value[0].name).toBe('Invoices v2');
    expect(store.dirty.value).toBe(false);
  });
});
