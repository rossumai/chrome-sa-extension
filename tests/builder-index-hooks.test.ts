// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { withKeys } from '../src/builder/model.js';
import { resetBuilderGlue, section, dp, fabryReply, heldFabryReply } from './support/builder.js';
import * as agentApi from '../src/agent/agentApi.js';
import * as api from '../src/builder/api.js';
import {
  openQueue,
  openRuleEditor,
  openHookEditor,
  updateHookDraft,
  saveHook,
  discardHook,
  askHookAssistant,
} from '../src/builder/index.jsx';

vi.mock('../src/builder/api.js');
vi.mock('../src/agent/agentApi.js');

beforeEach(resetBuilderGlue);

describe('hook mode (MDH)', () => {
  const hook = {
    id: 7,
    name: 'Vendor matching',
    settings: {
      configurations: [
        {
          source: { dataset: 'v', queries: [{ find: { vat: '{doc_id}' } }] },
          mapping: { dataset_key: 'id', target_schema_id: 'vendor' },
        },
      ],
    },
  };

  beforeEach(() => {
    vi.mocked(api.patchHookSettings).mockReset();
    vi.mocked(agentApi.streamMessage).mockReset();
    store.rightPanel.value = null;
    store.hooks.value = [hook];
    store.startDraft(
      'S',
      withKeys([
        section(
          's',
          [dp('doc_id', { label: 'Doc' }), dp('vendor', { label: 'Vendor', type: 'enum' })],
          { label: 'S' },
        ),
      ]),
    );
  });

  it('opening a queue loads its hooks', async () => {
    vi.mocked(api.getSchema).mockResolvedValue({ id: 22, content: [] });
    vi.mocked(api.listHooks).mockResolvedValue([hook]);
    store.queues.value = [{ id: 2, name: 'B', schema: 'https://x/api/v1/schemas/22' }];
    await openQueue(2);
    await vi.waitFor(() => expect(store.hooks.value.map((h) => h.id)).toEqual([7]));
    expect(api.listHooks).toHaveBeenCalledWith(2);
  });

  it('opens the hook settings as JSON, locks the schema, filters to its fields', () => {
    store.rules.value = [{ id: 4, name: 'R', trigger_condition: 'field.a', actions: [] }];
    openRuleEditor(4);
    openHookEditor(7);
    expect(store.ruleEditor.value).toBeNull();
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(hook.settings);
    expect(store.schemaLocked.value).toBe(true);
    expect([...store.hookFilterIds.value!].sort()).toEqual(['doc_id', 'vendor']);
  });

  it('refuses to save JSON that does not parse, then saves the settings', async () => {
    openHookEditor(7);
    updateHookDraft('{ broken');
    await saveHook();
    expect(api.patchHookSettings).not.toHaveBeenCalled();
    expect(store.hookErrors.value[0]).toContain('not valid JSON');
    const next = { configurations: [] };
    updateHookDraft(JSON.stringify(next));
    vi.mocked(api.patchHookSettings).mockResolvedValue({ ...hook, settings: next });
    await saveHook();
    expect(api.patchHookSettings).toHaveBeenCalledWith(7, next);
    expect(store.hooks.value[0].settings).toEqual(next);
    expect(store.hookDirty.value).toBe(false);
  });

  it('refuses to patch a hook someone changed after it was opened', async () => {
    store.hooks.value = [{ ...hook, modified_at: 't0' }];
    openHookEditor(7);
    updateHookDraft('{"configurations": []}');
    vi.mocked(api.getHook).mockResolvedValue({ id: 7, modified_at: 't1' });
    await saveHook();
    expect(api.getHook).toHaveBeenCalledWith(7);
    expect(api.patchHookSettings).not.toHaveBeenCalled();
    expect(store.hookErrors.value[0]).toContain('Someone changed this hook');
    expect(store.hookDirty.value).toBe(true);
  });

  it('a saved hook keeps its new modified_at, so the next save is not stale', async () => {
    store.hooks.value = [{ ...hook, modified_at: 't0' }];
    openHookEditor(7);
    updateHookDraft('{"configurations": []}');
    vi.mocked(api.getHook).mockResolvedValueOnce({ id: 7, modified_at: 't0' });
    vi.mocked(api.patchHookSettings).mockResolvedValue({
      id: 7,
      modified_at: 't1',
      settings: { configurations: [] },
    });
    await saveHook();
    expect(store.hooks.value[0].modified_at).toBe('t1');
  });

  it('Mr. Fabry fills the editor with new settings; Discard brings back the saved ones', async () => {
    openHookEditor(7);
    const proposed = {
      configurations: [
        {
          source: { queries: [{ find: { x: '{ghost}' } }] },
          mapping: { target_schema_id: 'vendor' },
        },
      ],
    };
    fabryReply('```json\n' + JSON.stringify(proposed) + '\n```');
    await askHookAssistant('match on ghost instead');
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(proposed);
    expect(store.hookAssist.value.warnings.join(' ')).toContain('ghost');
    discardHook();
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(hook.settings);
  });

  it('drops a late Mr. Fabry reply once another hook is open', async () => {
    store.hooks.value = [hook, { ...hook, id: 8, name: 'Other' }];
    openHookEditor(7);
    const release = heldFabryReply(JSON.stringify({ configurations: [] }));
    const asked = askHookAssistant('x');
    openHookEditor(8);
    release();
    await asked;
    expect(store.hookEditor.value!.hookId).toBe(8);
    expect(JSON.parse(store.hookEditor.value!.draft)).toEqual(hook.settings);
    expect(store.hookAssist.value.busy).toBe(false);
  });
});
