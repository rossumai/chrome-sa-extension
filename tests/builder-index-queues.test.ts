// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys } from '../src/builder/model.js';
import { resetBuilderGlue, section } from './support/builder.js';
import * as api from '../src/builder/api.js';
import {
  openQueue,
  openSchema,
  createWorkspace,
  createQueue,
  deleteQueue,
  deleteSchema,
  undoSchemaDelete,
  createUnlinkedSchema,
  openRuleEditor,
  pickAnnotation,
  loadSchemas,
  retryFailedLists,
} from '../src/builder/index.jsx';
import { rateLimitError } from '../src/net/rateLimit.js';

vi.mock('../src/builder/api.js');
vi.mock('../src/agent/agentApi.js');

beforeEach(resetBuilderGlue);

describe('openQueue', () => {
  it('ignores a schema response that arrives after a newer queue was opened', async () => {
    let releaseA: (v: any) => void = () => {};
    vi.mocked(api.getSchema).mockImplementation((id: number) =>
      id === 11
        ? new Promise((r) => (releaseA = r))
        : Promise.resolve({ id: 22, content: [section('b_section')] }),
    );
    const a = openQueue(1);
    await openQueue(2);
    releaseA({ id: 11, content: [section('a_section')] });
    await a;
    expect(store.selectedQueueId.value).toBe(2);
    expect(store.schema.value.id).toBe(22);
  });
});

describe('a 429 on a side list', () => {
  const slow = () => rateLimitError({}, 'slow');
  beforeEach(() => {
    store.queues.value = [
      { id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22', generic_engine: 'e/1' },
    ];
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [section('b')] });
    vi.mocked(api.listAnnotations).mockResolvedValue({ results: [] });
    vi.mocked(api.listRules).mockResolvedValue([]);
    vi.mocked(api.listHooks).mockResolvedValue([]);
    vi.mocked(api.listPreTrainedFields).mockResolvedValue([]);
  });

  it('loadSchemas shows it rather than an empty list', async () => {
    vi.mocked(api.listSchemas).mockRejectedValue(slow());
    await loadSchemas();
    expect(store.error.value).toContain('rate-limiting');
    expect(store.retryable.value).toBe(true);
  });

  it('loadSchemas keeps any other failure quiet', async () => {
    vi.mocked(api.listSchemas).mockRejectedValue(new Error('boom'));
    await loadSchemas();
    expect(store.error.value).toBeNull();
    expect(store.schemas.value).toEqual([]);
  });

  for (const f of ['listAnnotations', 'listRules', 'listHooks', 'listPreTrainedFields'] as const) {
    it(`${f} on opening a queue shows it`, async () => {
      vi.mocked(api[f]).mockRejectedValue(slow());
      await openQueue(2);
      await vi.waitFor(() => expect(store.error.value).toContain('rate-limiting'));
      expect(store.retryable.value).toBe(true);
      vi.mocked(api[f]).mockClear();
      retryFailedLists(); // the banner's Retry loads it again
      expect(api[f]).toHaveBeenCalledTimes(1);
    });
  }

  it('Retry loads the schema list again', async () => {
    vi.mocked(api.listSchemas).mockRejectedValueOnce(slow()).mockResolvedValueOnce([]);
    await loadSchemas();
    retryFailedLists();
    expect(api.listSchemas).toHaveBeenCalledTimes(2);
    retryFailedLists(); // nothing left to retry
    expect(api.listSchemas).toHaveBeenCalledTimes(2);
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

  it('a failed load leaves no content from the previous annotation', async () => {
    store.annotationId.value = 1;
    store.annotationContent.value = [{ category: 'section', schema_id: 'old', children: [] }];
    vi.mocked(api.getAnnotationContent).mockRejectedValue(new Error('gone'));
    await pickAnnotation('2');
    expect(store.annotationId.value).toBe(2);
    expect(store.annotationContent.value).toEqual([]);
    expect(store.annotationError.value).toBe('gone');
  });

  it('rejects input that is not an annotation id or URL', async () => {
    vi.mocked(api.getAnnotationContent).mockClear();
    await pickAnnotation('hello');
    expect(store.annotationError.value).toBe('Not an annotation ID or URL');
    expect(api.getAnnotationContent).not.toHaveBeenCalled();
  });
});

describe('openSchema / annotation labels', () => {
  it('opens a schema no queue uses', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 33, name: 'Orphan', content: [section('s')] });
    await openSchema(33);
    expect(api.getSchema).toHaveBeenCalledWith(33);
    expect(store.selectedQueueId.value).toBeNull();
    expect(store.selectedSchemaId.value).toBe(33);
    expect(store.draftName.value).toBe('Orphan');
  });

  it('labels annotations as file name (id) · status', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [section('b')] });
    vi.mocked(api.listAnnotations).mockResolvedValue({
      results: [
        { id: 5, status: 'to_review', document: 'd/1' },
        { id: 6, status: 'exported', document: 'd/2' },
      ],
      documents: [{ url: 'd/1', original_file_name: 'invoice.pdf' }],
    });
    await openQueue(2);
    await vi.waitFor(() => expect(store.annotations.value.length).toBe(2));
    expect(store.annotations.value.map((a) => a.label)).toEqual([
      'invoice.pdf (5) · to_review',
      'annotation (6) · exported',
    ]);
  });
});

describe('create and delete', () => {
  beforeEach(() => {
    for (const f of [
      'createWorkspace',
      'createSchema',
      'createQueue',
      'deleteQueue',
      'deleteSchema',
    ] as const) {
      vi.mocked(api[f]).mockReset();
    }
    vi.mocked(api.getSchema).mockResolvedValue({ id: 99, content: [section('x')] });
    store.workspaces.value = [{ id: 10, url: 'w/10', name: 'AP', organization: 'o/1' }];
  });

  it('creates a workspace in the organization of the existing ones', async () => {
    vi.mocked(api.createWorkspace).mockResolvedValue({ id: 11 });
    await createWorkspace('PO');
    expect(api.createWorkspace).toHaveBeenCalledWith('PO', 'o/1');
  });

  it('a queue with a copied schema creates the schema from the SAVED content first', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 's/7', content: [section('saved')] };
    store.startDraft('Inv', withKeys([section('saved')]));
    vi.mocked(api.createSchema).mockResolvedValue({ id: 70, url: 's/70' });
    vi.mocked(api.createQueue).mockResolvedValue({ id: 5, schema: 's/70' });
    await createQueue({ name: 'Inv 2', workspaceUrl: 'w/10', mode: 'copy' });
    expect(api.createSchema).toHaveBeenCalledWith('Inv 2', [section('saved')]);
    expect(api.createQueue).toHaveBeenCalledWith('Inv 2', 'w/10', 's/70');
  });

  it('a queue sharing a schema creates no schema', async () => {
    vi.mocked(api.createQueue).mockResolvedValue({ id: 5, schema: 's/7' });
    await createQueue({ name: 'Inv 3', workspaceUrl: 'w/10', mode: 'share', schemaUrl: 's/7' });
    expect(api.createSchema).not.toHaveBeenCalled();
    expect(api.createQueue).toHaveBeenCalledWith('Inv 3', 'w/10', 's/7');
  });

  it('a queue with an empty schema gets one empty section', async () => {
    vi.mocked(api.createSchema).mockResolvedValue({ id: 71, url: 's/71' });
    vi.mocked(api.createQueue).mockResolvedValue({ id: 6, schema: 's/71' });
    await createQueue({ name: 'Fresh', workspaceUrl: 'w/10', mode: 'empty' });
    expect(api.createSchema).toHaveBeenCalledWith('Fresh', [
      { category: 'section', id: 'basic_info_section', label: 'Basic information', children: [] },
    ]);
  });

  it('deleting a queue passes the choice on and clears it when it was open', async () => {
    store.queues.value = [{ id: 1, name: 'A', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    await deleteQueue(1, { now: false });
    expect(api.deleteQueue).toHaveBeenCalledWith(1, { now: false });
    expect(store.selectedQueueId.value).toBeNull();
  });

  it('deleting the open queue closes everything that belonged to it', async () => {
    store.queues.value = [{ id: 1, name: 'A', schema: 's/7' }];
    store.selectedQueueId.value = 1;
    store.rules.value = [{ id: 4, name: 'R', trigger_condition: 'field.a', actions: [] }];
    store.hooks.value = [{ id: 7, name: 'H', settings: {} }];
    store.engineState.value = { kind: 'generic', engine: null, fields: [], error: null };
    store.rightPanel.value = { kind: 'code', hookId: 7, fieldId: 'a' };
    store.schemaFabry.value = { ...store.schemaFabry.value, chatId: 'c', turns: [] };
    openRuleEditor(4);
    await deleteQueue(1, { now: true });
    expect(api.deleteQueue).toHaveBeenCalledWith(1, { now: true });
    expect(store.ruleEditor.value).toBeNull();
    expect(store.rules.value).toEqual([]);
    expect(store.hooks.value).toEqual([]);
    expect(store.engineState.value).toBeNull();
    expect(store.rightPanel.value).toBeNull();
    expect(store.schemaFabry.value.chatId).toBeNull();
  });

  it('deleting a schema keeps its name and content; Undo posts them back once', async () => {
    store.schemas.value = [{ id: 8, url: 's/8', name: 'Old' }];
    const content = [section('kept')];
    vi.mocked(api.getSchema).mockResolvedValue({ id: 8, name: 'Old', content });
    await deleteSchema(8);
    expect(api.deleteSchema).toHaveBeenCalledWith(8);
    expect(store.deletedSchema.value).toEqual({ name: 'Old', content });
    vi.mocked(api.createSchema).mockResolvedValue({ id: 81, url: 's/81' });
    await undoSchemaDelete();
    expect(api.createSchema).toHaveBeenCalledWith('Old', content);
    expect(store.deletedSchema.value).toBeNull();
    expect(api.listSchemas).toHaveBeenCalled();
  });

  it('does not delete a schema it could not read first, so Undo always has a snapshot', async () => {
    vi.mocked(api.getSchema).mockRejectedValue(new Error('boom'));
    await deleteSchema(8);
    expect(api.deleteSchema).not.toHaveBeenCalled();
    expect(store.deletedSchema.value).toBeNull();
  });

  it('creates a schema with no queue, from the saved open schema or empty, and opens it', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 's/7', content: [section('saved')] };
    vi.mocked(api.createSchema).mockResolvedValue({ id: 80, url: 's/80' });
    vi.mocked(api.getSchema).mockResolvedValue({
      id: 80,
      name: 'Spare',
      content: [section('saved')],
    });
    await createUnlinkedSchema('Spare', 'copy');
    expect(api.createSchema).toHaveBeenLastCalledWith('Spare', [section('saved')]);
    expect(store.selectedSchemaId.value).toBe(80);
    expect(store.selectedQueueId.value).toBeNull();
    await createUnlinkedSchema('Blank', 'empty');
    expect(api.createSchema).toHaveBeenLastCalledWith('Blank', [
      { category: 'section', id: 'basic_info_section', label: 'Basic information', children: [] },
    ]);
  });
});
