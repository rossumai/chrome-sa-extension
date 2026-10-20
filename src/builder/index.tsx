// src/builder/index.tsx
// Impure glue for the Builder: session probe, queue list, opening a queue's schema,
// the history actions the screen calls, and Save.
import * as api from './api.js';
import * as store from './store.js';
import { push, undo, redo } from './history.js';
import {
  withKeys,
  findByKey,
  mergeAttrs,
  localErrors,
  stripForSave,
  rowStatus,
  movedKeys,
  flatten,
  type Node,
} from './model.js';
import { saveSchema, mapValidateErrors, type SaveResult } from './save.js';
import { isRateLimited, rateLimitMessage } from '../net/rateLimit.js';
import { annotationIdFromInput } from '../rossum/annotationUrl.js';
import { annotationValues } from './values.js';
import * as agentApi from '../agent/agentApi.js';
import { buildRulePrompt, buildFollowupPrompt, parseRuleReply } from './ruleAssist.js';
import { runAssist, schemaFieldList } from './assist.js';
import { buildFieldPrompt, buildFieldFollowup, parseFieldReply } from './fieldAssist.js';
import {
  compactSchema,
  buildSchemaPrompt,
  buildSchemaFollowup,
  buildFixPrompt,
  parseSchemaReply,
  applyChanges,
  fitSchema,
} from './schemaAssist.js';
import { draftFromRule, emptyDraft, draftBody, draftErrors, type RuleDraft } from './ruleDraft.js';

function fail(err: any, fallback: string) {
  store.error.value = isRateLimited(err) ? rateLimitMessage(err) : err?.message || fallback;
  store.retryable.value = isRateLimited(err);
}

let unloadGuard = false;

export async function initBuilder() {
  store.error.value = null;
  store.retryable.value = false;
  try {
    await api.whoami();
  } catch (err: any) {
    fail(err, 'Failed to verify session');
    store.connected.value = false;
    return;
  }
  store.connected.value = true;
  if (!unloadGuard) {
    unloadGuard = true;
    window.addEventListener('beforeunload', (e) => {
      if (store.dirty.value) e.preventDefault();
    });
  }
  loadQueues();
  loadSchemas();
}

// Names for the schema column. Separate from the queue list so a slow or failed schema
// list never holds back the queues.
export async function loadSchemas() {
  try {
    const all = await api.listSchemas();
    store.schemas.value = all.map((x) => ({ id: x.id, url: x.url, name: x.name }));
  } catch {
    store.schemas.value = [];
  }
}

export async function loadQueues() {
  store.loading.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    const [ws, qs] = await Promise.all([api.listWorkspaces(), api.listQueues()]);
    store.workspaces.value = ws;
    store.queues.value = qs;
  } catch (err: any) {
    fail(err, 'Failed to load queues');
  } finally {
    store.loading.value = false;
  }
}

function idFromUrl(url: unknown): number | null {
  const m = /\/(\d+)\/?$/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
}

function setBase(schema: any) {
  store.schema.value = schema;
  // Keys are regenerated per load (k1, k2…), so a field chat must not outlive its schema.
  store.fieldAssist.value = {
    forKey: null,
    chatId: null,
    busy: false,
    error: null,
    reply: null,
    warnings: [],
  };
  store.startDraft(schema?.name ?? '', withKeys(schema?.content || []));
  store.rowErrors.value = new Map();
  store.generalErrors.value = [];
}

// Bumped on every openQueue: a response for a queue that is no longer the current one is
// dropped, or queue A's schema would show (and save) under queue B.
let openSeq = 0;

export async function openQueue(id: number) {
  const q = store.queues.value.find((x) => x.id === id);
  return load(id, idFromUrl(q?.schema));
}

/** Open a schema directly — the way in for a schema no queue uses. */
export async function openSchema(schemaId: number) {
  return load(null, schemaId);
}

async function load(queueId: number | null, schemaId: number | null) {
  if (store.dirty.value && !confirm('Discard the staged changes to this schema?')) return;
  if (store.ruleDirty.value && !confirm('Discard the unsaved changes to this rule?')) return;
  store.ruleEditor.value = null;
  // A new schema, a new conversation: Mr. Fabry's context and its row keys belong to the old one.
  store.schemaFabry.value = {
    ...store.schemaFabry.value,
    chatId: null,
    busy: false,
    error: null,
    turns: [],
    problems: [],
  };
  store.fabryTouched.value = new Set();
  store.onlyFabryChanges.value = false;
  const seq = ++openSeq;
  store.selectedQueueId.value = queueId;
  store.selectedSchemaId.value = schemaId;
  clearAnnotation();
  store.annotations.value = [];
  store.rules.value = [];
  store.ruleId.value = null;
  store.selectedKey.value = null;
  store.schema.value = null;
  store.loading.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    if (schemaId == null) throw new Error('This queue has no schema');
    const schema = await api.getSchema(schemaId);
    if (seq !== openSeq) return;
    setBase(schema);
    if (queueId != null) {
      loadAnnotations(queueId);
      loadRules(queueId);
    }
  } catch (err: any) {
    if (seq !== openSeq) return;
    setBase(null);
    fail(err, 'Failed to load the schema');
  } finally {
    if (seq === openSeq) store.loading.value = false;
  }
}

/** One user action = one history entry. */
export function apply(next: Node[]) {
  if (next === store.work.value) return;
  store.history.value = push(store.history.value, {
    ...store.history.value.present,
    content: next,
  });
}

/** Stage a new name for the open schema; it is sent with the next Save. */
export function renameSchema(name: string) {
  if (name === store.draftName.value) return;
  store.history.value = push(store.history.value, { ...store.history.value.present, name });
}

export function undoChange() {
  store.history.value = undo(store.history.value);
}

export function redoChange() {
  store.history.value = redo(store.history.value);
}

export function discard() {
  store.startDraft(store.baseName.value, store.base.value);
  store.rowErrors.value = new Map();
  store.generalErrors.value = [];
}

export async function save(force = false): Promise<SaveResult | null> {
  const schema = store.schema.value;
  if (!schema) return null;
  store.saving.value = true;
  store.error.value = null;
  store.retryable.value = false;
  try {
    const r = await saveSchema(
      {
        schemaId: schema.id,
        baseModifiedAt: schema.modified_at ?? null,
        work: store.work.value,
        force,
        name: store.draftName.value,
        baseName: store.baseName.value,
      },
      api,
    );
    const byRow = new Map<string, string[]>();
    const general: string[] = [];
    if (!r.ok) {
      for (const e of r.errors) {
        if (e.key) byRow.set(e.key, [...(byRow.get(e.key) || []), e.message]);
        else general.push(e.message);
      }
    } else {
      setBase(r.schema);
      store.schemas.value = store.schemas.value.map((x) =>
        x.id === r.schema?.id ? { ...x, name: r.schema.name ?? x.name } : x,
      );
      if (r.warnings.length) general.push(`Did not land as sent: ${r.warnings.join(', ')}`);
    }
    store.rowErrors.value = byRow;
    store.generalErrors.value = general;
    return r;
  } catch (err: any) {
    fail(err, 'Save failed');
    return null;
  } finally {
    store.saving.value = false;
  }
}

function annotationLabel(a: any, docs: Map<string, any>): string {
  const name = docs.get(a.document)?.original_file_name;
  return `${name || 'annotation'} (${a.id}) · ${a.status}`;
}

// Fills the picker. A failure leaves it empty; pasting an ID still works.
async function loadAnnotations(queueId: number) {
  try {
    const page = await api.listAnnotations(queueId);
    if (store.selectedQueueId.value !== queueId) return;
    const docs = new Map<string, any>((page?.documents || []).map((d: any) => [d.url, d]));
    store.annotations.value = (page?.results || []).map((a: any) => ({
      id: a.id,
      label: annotationLabel(a, docs),
    }));
  } catch {
    store.annotations.value = [];
  }
}

// Fills the rule picker. A failure leaves it empty (the picker then says so).
async function loadRules(queueId: number) {
  try {
    const list = await api.listRules(queueId);
    if (store.selectedQueueId.value !== queueId) return;
    store.rules.value = list;
  } catch {
    store.rules.value = [];
  }
}

let pickSeq = 0;

export function clearAnnotation() {
  pickSeq++;
  store.annotationId.value = null;
  store.values.value = null;
  store.lineRow.value = {};
  store.annotationError.value = null;
}

/** Accepts an annotation id, a Rossum annotation/document URL, or an API URL. */
export async function pickAnnotation(input: string) {
  const raw = annotationIdFromInput(input);
  if (!raw) {
    store.annotationError.value = 'Not an annotation ID or URL';
    return;
  }
  const id = Number(raw);
  const seq = ++pickSeq;
  store.annotationId.value = id;
  store.annotationError.value = null;
  store.lineRow.value = {};
  try {
    const data = await api.getAnnotationContent(id);
    if (seq !== pickSeq) return;
    store.values.value = annotationValues(data?.content || []);
  } catch (err: any) {
    if (seq !== pickSeq) return;
    store.values.value = null;
    store.annotationError.value = isRateLimited(err)
      ? rateLimitMessage(err)
      : err?.message || 'Failed to load the annotation';
  }
}

// ---- Creating and deleting workspaces, queues and schemas -------------------------------
// These act at once, after a confirmation for deletes: they are not staged with Save.

async function refreshLists() {
  await Promise.all([loadQueues(), loadSchemas()]);
}

// The organization a new workspace belongs to: the one the existing workspaces are in, or
// the org list's only entry. auth/user's organization is the user's HOME org, which can
// differ (see src/rossum/orgName.ts), so it is not used.
async function organizationUrl(): Promise<string> {
  const known = store.workspaces.value.find((w) => w.organization)?.organization;
  if (known) return known;
  const page = await api.get('/api/v1/organizations/');
  const orgs = page?.results || [];
  if (orgs.length === 1) return orgs[0].url;
  throw new Error('Could not tell which organization to create the workspace in');
}

export async function createWorkspace(name: string): Promise<boolean> {
  try {
    await api.createWorkspace(name, await organizationUrl());
    await refreshLists();
    return true;
  } catch (err: any) {
    fail(err, 'Failed to create the workspace');
    return false;
  }
}

export type NewQueue = {
  name: string;
  workspaceUrl: string;
  mode: 'copy' | 'share' | 'empty';
  schemaUrl?: string;
};

export function emptySchemaContent(): any[] {
  return [
    { category: 'section', id: 'basic_info_section', label: 'Basic information', children: [] },
  ];
}

/** Copy = the open schema as last SAVED (staged edits are not copied). */
export async function createQueue(p: NewQueue): Promise<boolean> {
  let created: any = null;
  try {
    let schemaUrl = p.schemaUrl;
    if (p.mode === 'copy') {
      const content = store.schema.value?.content;
      if (!content) throw new Error('Open a schema first to copy it');
      created = await api.createSchema(p.name, content);
      schemaUrl = created.url;
    } else if (p.mode === 'empty') {
      created = await api.createSchema(p.name, emptySchemaContent());
      schemaUrl = created.url;
    }
    if (!schemaUrl) throw new Error('Pick a schema for the new queue');
    let queue: any;
    try {
      queue = await api.createQueue(p.name, p.workspaceUrl, schemaUrl);
    } catch (err: any) {
      if (created) {
        err.message = `${err.message} — the schema "${p.name}" (${created.id}) was created and is now listed without a queue`;
      }
      throw err;
    }
    await refreshLists();
    if (queue?.id != null) await openQueue(queue.id);
    return true;
  } catch (err: any) {
    await refreshLists().catch(() => {});
    fail(err, 'Failed to create the queue');
    return false;
  }
}

/** A schema no queue uses yet: a copy of the open schema as saved, or one empty section. */
export async function createUnlinkedSchema(name: string, mode: 'copy' | 'empty'): Promise<boolean> {
  try {
    let content = emptySchemaContent();
    if (mode === 'copy') {
      if (!store.schema.value?.content) throw new Error('Open a schema first to copy it');
      content = store.schema.value.content;
    }
    const created = await api.createSchema(name, content);
    await refreshLists();
    if (created?.id != null) await openSchema(created.id);
    return true;
  } catch (err: any) {
    fail(err, 'Failed to create the schema');
    return false;
  }
}

function closeEditor() {
  openSeq++;
  store.selectedQueueId.value = null;
  store.selectedSchemaId.value = null;
  store.schema.value = null;
  store.startDraft('', []);
  clearAnnotation();
}

export async function deleteQueue(id: number) {
  const q = store.queues.value.find((x) => x.id === id);
  const open = store.selectedQueueId.value === id;
  const lose = open && store.dirty.value ? ' Your staged schema changes are lost.' : '';
  const msg = `Delete queue ${q?.name ?? 'queue'} (${id}) now? This cannot be undone. Its schema is kept.${lose}`;
  if (!confirm(msg)) return;
  try {
    await api.deleteQueue(id);
    if (open) closeEditor();
    await refreshLists();
  } catch (err: any) {
    fail(err, 'Failed to delete the queue');
  }
}

export async function deleteSchema(id: number) {
  const x = store.schemas.value.find((y) => y.id === id);
  const open = store.selectedSchemaId.value === id;
  if (!confirm(`Delete schema ${x?.name ?? 'schema'} (${id}) now? This cannot be undone.`)) return;
  try {
    await api.deleteSchema(id);
    if (open) closeEditor();
    await refreshLists();
  } catch (err: any) {
    fail(err, 'Failed to delete the schema');
  }
}

// ---- Rule mode ---------------------------------------------------------------------------
// The right panel edits one native Rule. A rule is its own object in Rossum, so it has its
// own Save, separate from the schema's staged edits and undo stack.

/** Open a rule from the queue's list, or a new one (null) — started from `fieldId` if given. */
export function openRuleEditor(id: number | null, fieldId?: string) {
  if (store.ruleDirty.value && !confirm('Discard the unsaved changes to this rule?')) return;
  const rule = id == null ? null : store.rules.value.find((r) => r.id === id);
  const draft = rule ? draftFromRule(rule) : emptyDraft(fieldId);
  store.schemaFabry.value = { ...store.schemaFabry.value, open: false }; // one right panel at a time
  store.ruleEditor.value = {
    ruleId: rule ? rule.id : null,
    base: draft,
    draft,
    fromField: rule ? null : (fieldId ?? null),
  };
  store.assist.value = { chatId: null, busy: false, error: null, reply: null, warnings: [] };
  store.ruleErrors.value = [];
  store.selectedKey.value = null;
  if (rule) store.ruleId.value = rule.id;
}

export function updateRuleDraft(patch: Partial<RuleDraft>) {
  const ed = store.ruleEditor.value;
  if (!ed) return;
  store.ruleEditor.value = { ...ed, draft: { ...ed.draft, ...patch } };
}

export function closeRuleEditor() {
  if (store.ruleDirty.value && !confirm('Discard the unsaved changes to this rule?')) return;
  store.ruleEditor.value = null;
  store.ruleErrors.value = [];
  store.ruleId.value = null;
}

export async function saveRule() {
  const ed = store.ruleEditor.value;
  const queue = store.selectedQueue.value;
  if (!ed) return;
  const errors = draftErrors(ed.draft);
  if (!queue && ed.ruleId == null) errors.push('Open a queue to attach the new rule to');
  store.ruleErrors.value = errors;
  if (errors.length) return;
  store.ruleSaving.value = true;
  try {
    const saved =
      ed.ruleId != null
        ? await api.patchRule(ed.ruleId, draftBody(ed.draft))
        : await api.createRule(
            draftBody(ed.draft, {
              queueUrl: queue!.url,
              organization: await organizationUrl().catch(() => undefined),
            }),
          );
    if (queue) await loadRules(queue.id);
    const draft = draftFromRule(saved);
    store.ruleEditor.value = { ruleId: saved?.id ?? ed.ruleId, base: draft, draft };
    if (saved?.id != null) store.ruleId.value = saved.id;
  } catch (err: any) {
    store.ruleErrors.value = [
      isRateLimited(err) ? rateLimitMessage(err) : err?.message || 'Failed to save the rule',
    ];
  } finally {
    store.ruleSaving.value = false;
  }
}

/** Put the open rule back as it was opened (or last saved). */
export function discardRule() {
  const ed = store.ruleEditor.value;
  if (!ed) return;
  store.ruleEditor.value = { ...ed, draft: ed.base };
  store.ruleErrors.value = [];
  store.assistRev.value++;
}

/**
 * Ask Mr. Fabry for the rule described in `request`. A usable answer fills the editor (still
 * unsaved — Discard undoes it); anything else is shown with the raw reply. Read-only chat.
 */
export async function askRuleAssistant(request: string) {
  const ed = store.ruleEditor.value;
  if (!ed || !request.trim() || store.assist.value.busy) return;
  const prev = store.assist.value;
  store.assist.value = { ...prev, busy: true, error: null, reply: null, warnings: [] };
  const fields = schemaFieldList(store.work.value);
  const changed = ed.ruleId != null || JSON.stringify(ed.draft) !== JSON.stringify(ed.base);
  const content = prev.chatId
    ? buildFollowupPrompt(request, ed.draft)
    : buildRulePrompt({
        request,
        fields,
        startField: ed.fromField ?? null,
        current: changed ? ed.draft : null,
      });
  try {
    const { chatId, text } = await runAssist({ agentApi, chatId: prev.chatId, content });
    if (!store.ruleEditor.value) return; // closed while Mr. Fabry was writing
    const r = parseRuleReply(text, new Set(fields.map((f) => f.id)));
    if (!r.ok) {
      store.assist.value = { chatId, busy: false, error: r.error, reply: text, warnings: [] };
      return;
    }
    updateRuleDraft(r.draft);
    store.assistRev.value++;
    store.assist.value = {
      chatId,
      busy: false,
      error: null,
      reply: null,
      warnings: r.unknownFields.length ? [`Not in this schema: ${r.unknownFields.join(', ')}`] : [],
    };
  } catch (err: any) {
    const msg =
      err?.status === 401
        ? 'Session expired. Open the Console from a Rossum tab again.'
        : err?.message || 'Mr. Fabry is not available';
    store.assist.value = { ...store.assist.value, busy: false, error: msg };
  }
}

/**
 * Ask Mr. Fabry to change one field (a formula, typically). A usable answer is applied as ONE
 * undoable schema edit, staged until Save like any other; anything else changes nothing.
 */
export async function askFieldAssistant(key: string, request: string) {
  const node = findByKey(store.work.value, key);
  if (!node || !request.trim() || store.fieldAssist.value.busy) return;
  const prev = store.fieldAssist.value.forKey === key ? store.fieldAssist.value : null;
  const chatId = prev?.chatId ?? null;
  store.fieldAssist.value = {
    forKey: key,
    chatId,
    busy: true,
    error: null,
    reply: null,
    warnings: [],
  };
  const fields = schemaFieldList(store.work.value);
  const info = fields.find((f) => f.id === node.id);
  const content = chatId
    ? buildFieldFollowup(request, node)
    : buildFieldPrompt({ request, field: node, fields, table: info?.table ?? null });
  try {
    const res = await runAssist({ agentApi, chatId, content });
    const r = parseFieldReply(res.text, {
      selfId: String(node.id),
      schemaIds: new Set(fields.map((f) => f.id)),
    });
    if (!r.ok) {
      store.fieldAssist.value = {
        forKey: key,
        chatId: res.chatId,
        busy: false,
        error: r.error,
        reply: res.text,
        warnings: [],
      };
      return;
    }
    if (findByKey(store.work.value, key)) apply(mergeAttrs(store.work.value, key, r.patch));
    store.fieldAssist.value = {
      forKey: key,
      chatId: res.chatId,
      busy: false,
      error: null,
      reply: null,
      warnings: r.warnings,
    };
  } catch (err: any) {
    const msg =
      err?.status === 401
        ? 'Session expired. Open the Console from a Rossum tab again.'
        : err?.message || 'Mr. Fabry is not available';
    store.fieldAssist.value = { ...store.fieldAssist.value, busy: false, error: msg };
  }
}

// ---- Mr. Fabry for the whole schema --------------------------------------------------------

export function openSchemaFabry() {
  if (store.ruleEditor.value) closeRuleEditor();
  if (store.ruleEditor.value) return; // the user kept an unsaved rule open
  store.schemaFabry.value = { ...store.schemaFabry.value, open: true };
  store.selectedKey.value = null;
}

export function closeSchemaFabry() {
  store.schemaFabry.value = { ...store.schemaFabry.value, open: false };
  store.onlyFabryChanges.value = false;
}

/**
 * Ask for schema changes (or, with `fix`, for fixes to the problems left by the last answer).
 * Every change that can be applied is, as ONE undoable edit; the result is checked locally and
 * with the validate dry run; what is still wrong is shown on rows and kept for "fix".
 */
export async function askSchemaFabry(request: string, fix?: string[]) {
  const st = store.schemaFabry.value;
  if (st.busy || (!fix && !request.trim())) return;
  const schema = compactSchema(store.work.value);
  const fitted = fitSchema(schema, (sch) =>
    fix
      ? buildFixPrompt(fix, sch)
      : st.chatId
        ? buildSchemaFollowup(request, sch)
        : buildSchemaPrompt({ request, schema: sch }),
  );
  if (!fitted.ok) {
    store.schemaFabry.value = { ...st, error: fitted.error };
    return;
  }
  const content = fitted.prompt;
  const you = { role: 'you' as const, text: fix ? 'Fix the problems above.' : request };
  store.schemaFabry.value = { ...st, busy: true, error: null, turns: [...st.turns, you] };
  try {
    const res = await runAssist({ agentApi, chatId: st.chatId, content });
    const parsed = parseSchemaReply(res.text);
    const cur = store.schemaFabry.value;
    if (!parsed.ok) {
      store.schemaFabry.value = {
        ...cur,
        chatId: res.chatId,
        busy: false,
        turns: [...cur.turns, { role: 'fabry', text: parsed.error, reply: res.text }],
      };
      return;
    }
    const before = store.work.value;
    const r = applyChanges(before, parsed.changes);
    if (r.applied) apply(r.nodes);
    store.fabryTouched.value = new Set([
      ...store.fabryTouched.value,
      ...rowStatus(before, r.nodes).keys(),
      ...movedKeys(before, r.nodes),
    ]);

    // Check the exact content Save would send: local rules, then the validate dry run.
    const problems = r.skipped.map((x) => `Skipped: ${x.reason}`);
    const errs = localErrors(r.nodes);
    const sch = store.schema.value;
    if (!errs.length && sch) {
      try {
        const verdict = await api.validateSchema(sch.id, stripForSave(r.nodes));
        if (verdict && Object.keys(verdict).length)
          errs.push(...mapValidateErrors(verdict, r.nodes));
      } catch (err: any) {
        problems.push(`Could not validate: ${err?.message || 'unknown error'}`);
      }
    }
    const idOf = new Map(flatten(r.nodes).map((x) => [x.key, String(x.node.id)]));
    const byRow = new Map<string, string[]>();
    for (const e of errs) {
      if (e.key) byRow.set(e.key, [...(byRow.get(e.key) || []), e.message]);
      problems.push(e.key ? `${idOf.get(e.key)}: ${e.message}` : e.message);
    }
    store.rowErrors.value = byRow;
    store.schemaFabry.value = {
      ...cur,
      chatId: res.chatId,
      busy: false,
      problems,
      turns: [
        ...cur.turns,
        {
          role: 'fabry',
          text: [parsed.summary || 'Done.', fitted.note].filter(Boolean).join(' '),
          applied: r.applied,
          problems,
        },
      ],
    };
  } catch (err: any) {
    const msg =
      err?.status === 401
        ? 'Session expired. Open the Console from a Rossum tab again.'
        : err?.message || 'Mr. Fabry is not available';
    store.schemaFabry.value = { ...store.schemaFabry.value, busy: false, error: msg };
  }
}

/** Send exactly the problems left by the last answer back to the same chat. */
export function fixWithFabry() {
  const problems = store.schemaFabry.value.problems;
  if (problems.length) return askSchemaFabry('', problems);
  return Promise.resolve();
}
