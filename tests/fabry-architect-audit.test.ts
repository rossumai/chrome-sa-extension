import { describe, it, expect } from 'vitest';
import { isWriteTool, summarizeArgs, makeAuditFolder } from '../src/fabry/architect/audit.js';

describe('isWriteTool', () => {
  it('classifies writes vs reads', () => {
    expect(isWriteTool('create_rule')).toBe(true);
    expect(isWriteTool('patch_schema')).toBe(true);
    expect(isWriteTool('delete_queue')).toBe(true);
    expect(isWriteTool('get_queue')).toBe(false);
    expect(isWriteTool('list_hooks')).toBe(false);
    expect(isWriteTool('data_storage_aggregate')).toBe(false);
  });
  it('fails safe: an unrecognized tool name is treated as a write (previously fail-open)', () => {
    expect(isWriteTool('apply_labels')).toBe(true);
    expect(isWriteTool('duplicate_queue')).toBe(true);
    expect(isWriteTool('cancel_annotation')).toBe(true);
  });
  it('strips a known namespace before classifying (rossum_ / data_storage_)', () => {
    expect(isWriteTool('rossum_create_hook')).toBe(true);
    expect(isWriteTool('rossum_get_hook')).toBe(false);
    expect(isWriteTool('data_storage_delete_many')).toBe(true);
    expect(isWriteTool('data_storage_aggregate')).toBe(false);
  });
  it('exempts agent-internal utilities (never org mutations)', () => {
    expect(isWriteTool('load_skill')).toBe(false);
    expect(isWriteTool('execute_python')).toBe(false);
    expect(isWriteTool('create_task')).toBe(false);
  });
});
describe('summarizeArgs', () => {
  it('redacts to a short name/#id, never a full payload', () => {
    expect(summarizeArgs({ name: 'VAT rule', id: 42, secret: 'x'.repeat(500) })).toBe(
      'VAT rule #42',
    );
  });
});
describe('generic rossum_api_* tools (svc/rossum-agent)', () => {
  it('classifies the generic rossum_api_* tools', () => {
    expect(isWriteTool('rossum_api_write')).toBe(true);
    expect(isWriteTool('rossum_api_read')).toBe(false);
    expect(isWriteTool('rossum_api_search')).toBe(false);
    expect(isWriteTool('rossum_api_describe')).toBe(false);
    expect(isWriteTool('rossum_api_frobnicate')).toBe(true); // fail-safe unchanged
  });
  it('summarizes a generic write as method, path and body name', () => {
    expect(summarizeArgs({ method: 'POST', path: '/labels', body: { name: 'x' } })).toBe(
      'POST /labels x',
    );
    expect(summarizeArgs({ method: 'DELETE', path: '/labels/25559' })).toBe('DELETE /labels/25559');
  });
  it('journals only the write in a new-service implement stream', () => {
    const f = makeAuditFolder({ now: () => 7 });
    const calls: [string, string, unknown][] = [
      ['a', 'rossum_api_search', {}],
      ['b', 'rossum_api_describe', { operationId: 'labels_create' }],
      ['c', 'rossum_api_write', { method: 'POST', path: '/labels', body: { name: 'x' } }],
    ];
    for (const [id, name, input] of calls) {
      f.feed({ type: 'tool-input-start', toolCallId: id, toolName: name });
      f.feed({ type: 'tool-input-available', toolCallId: id, toolName: name, input });
      f.feed({ type: 'tool-output-available', toolCallId: id, output: 'ok' });
    }
    expect(f.writes).toEqual([
      { tool: 'rossum_api_write', argsSummary: 'POST /labels x', ok: true, at: 7 },
    ]);
  });
});
describe('makeAuditFolder', () => {
  it('records write tool calls (name + args + ok) and ignores reads', () => {
    const f = makeAuditFolder({ now: () => 7 });
    f.feed({ type: 'tool-input-start', toolCallId: 't1', toolName: 'get_queue' });
    f.feed({ type: 'tool-input-start', toolCallId: 't2', toolName: 'create_rule' });
    f.feed({ type: 'tool-input-available', toolCallId: 't2', input: { name: 'VAT' } });
    f.feed({ type: 'tool-output-available', toolCallId: 't2', output: 'ok' });
    expect(f.writes).toEqual([{ tool: 'create_rule', argsSummary: 'VAT', ok: true, at: 7 }]);
  });
  it('a previously fail-open tool (apply_labels) is still recorded as a write', () => {
    const f = makeAuditFolder({ now: () => 0 });
    f.feed({ type: 'tool-input-start', toolCallId: 't1', toolName: 'apply_labels' });
    expect(f.writes[0]).toMatchObject({ tool: 'apply_labels', ok: null });
  });
});
