// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/builder/store.js';
import { resetBuilderGlue } from './support/builder.js';
import * as api from '../src/builder/api.js';
import { revalidate } from '../src/builder/index.jsx';

vi.mock('../src/builder/api.js');
vi.mock('../src/agent/agentApi.js');

beforeEach(resetBuilderGlue);

describe('revalidate', () => {
  const content = (v: string) => ({
    content: [
      {
        category: 'section',
        schema_id: 's',
        children: [{ category: 'datapoint', id: 101, schema_id: 'doc_id', content: { value: v } }],
      },
    ],
  });
  beforeEach(() => {
    for (const f of [
      'getAnnotation',
      'startAnnotation',
      'validateAnnotation',
      'cancelAnnotation',
      'getAnnotationContent',
    ] as const) {
      vi.mocked(api[f]).mockReset();
    }
    vi.mocked(api.startAnnotation).mockResolvedValue({});
    vi.mocked(api.cancelAnnotation).mockResolvedValue({});
    store.annotationId.value = 5;
    store.validation.value = null;
    store.revalidateError.value = null;
  });

  it('starts a document in review, validates, refreshes the values, and hands it back', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'to_review' });
    vi.mocked(api.validateAnnotation).mockResolvedValue({
      messages: [{ id: 101, type: 'error', content: 'Missing' }],
      matched_trigger_rules: [4],
    });
    vi.mocked(api.getAnnotationContent).mockResolvedValue(content('NEW'));
    store.rightPanel.value = null;
    await revalidate();
    expect(store.rightPanel.value).toEqual({ kind: 'validation', tab: 'rules' }); // results open in the right panel
    expect(api.startAnnotation).toHaveBeenCalledWith(5);
    expect(api.cancelAnnotation).toHaveBeenCalledWith(5);
    expect(store.values.value!.values.get('doc_id')).toEqual(['NEW']);
    expect(store.validation.value!.placed.byField.get('doc_id')!.get(0)![0].content).toBe(
      'Missing',
    );
    expect([...store.validation.value!.fired]).toEqual([4]);
  });

  it('leaves a document you already review as it is', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'reviewing' });
    vi.mocked(api.validateAnnotation).mockResolvedValue({ messages: [] });
    vi.mocked(api.getAnnotationContent).mockResolvedValue(content('x'));
    await revalidate();
    expect(api.startAnnotation).not.toHaveBeenCalled();
    expect(api.cancelAnnotation).not.toHaveBeenCalled();
  });

  it('refuses a document that is not in review', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'exported' });
    await revalidate();
    expect(api.startAnnotation).not.toHaveBeenCalled();
    expect(store.revalidateError.value).toContain('exported');
  });

  it('still hands the document back when validation fails', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ id: 5, status: 'to_review' });
    vi.mocked(api.validateAnnotation).mockRejectedValue(new Error('boom'));
    await revalidate();
    expect(api.cancelAnnotation).toHaveBeenCalledWith(5);
    expect(store.revalidateError.value).toBe('boom');
  });
});
