// src/builder/index.tsx
// Impure glue for the Builder: the session probe and side lists, opening a queue or schema,
// the draft's history and Save, the engine, the picked annotation, creating and deleting
// workspaces, queues and schemas, the right panels (rule, hook, code view, engine, Mr. Fabry,
// validation) with their own saves and Mr. Fabry turns, and Revalidate.
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
  emptySchemaContent,
  type Node,
} from './model.js';
import { saveSchema, localStage, mapValidateErrors, errorsByRow, type SaveResult } from './save.js';
import { engineKind, bindingErrors, engineFieldUsers, otherEngineQueues } from './engine.js';
import { isRateLimited, errorText } from '../net/rateLimit.js';
import { annotationIdFromInput } from '../rossum/annotationUrl.js';
import { idFromUrl } from '../galaxy/graph.js';
import { currentOrg } from '../rossum/orgName.js';
import { annotationValues } from './values.js';
import { annotationRows } from './links.js';
import { placeMessages, firedRuleIds, revalidateStart } from './validation.js';
import { ruleEvalBody, parseRuleEval } from './ruleEval.js';
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
  problemList,
} from './schemaAssist.js';
import { buildHookPrompt, buildHookFollowup, parseHookReply } from './hookAssist.js';
import { draftFromRule, emptyDraft, draftBody, draftErrors, type RuleDraft } from './ruleDraft.js';
import { parseSettings } from './hookDraft.js';

function fail(err: any, fallback: string) {
  store.error.value = errorText(err, fallback);
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
// list never holds back the queues. Like the other side lists below, a failure leaves it
// empty — except a 429, which is shown (a throttled list is not an empty one).
export async function loadSchemas() {
  try {
    const all = await api.listSchemas();
    store.schemas.value = all.map((x) => ({ id: x.id, url: x.url, name: x.name }));
  } catch (err: any) {
    if (isRateLimited(err)) fail(err, '');
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

// Each Mr. Fabry assistant's sequence, bumped by a new question and wherever its target is
// replaced (another rule, hook or schema; a save renumbers row keys): a reply for an older
// target is dropped, as openQueue drops a stale schema.
const assistSeq = { rule: 0, field: 0, schema: 0, hook: 0 };

/**
 * One read-only Mr. Fabry turn for one assistant. The reply goes to `onReply` unless a newer
 * question or a new target made it stale, or `stillOpen()` says its panel is gone; `current`
 * tells the same after a later await. A failure goes to `onError`, if still current.
 */
async function assistTurn(
  who: keyof typeof assistSeq,
  {
    chatId,
    content,
    stillOpen = () => true,
    onReply,
    onError,
  }: {
    chatId: string | null;
    content: string;
    stillOpen?: () => boolean;
    onReply: (res: { chatId: string; text: string }, current: () => boolean) => unknown;
    onError: (message: string) => void;
  },
) {
  const seq = ++assistSeq[who];
  const current = () => seq === assistSeq[who];
  try {
    const res = await runAssist({ agentApi, chatId, content });
    if (current() && stillOpen()) await onReply(res, current);
  } catch (err: any) {
    if (current()) onError(err?.message || 'Mr. Fabry is not available');
  }
}

function setBase(schema: any) {
  store.schema.value = schema;
  assistSeq.field++;
  // Keys are regenerated per load (k1, k2…), so a field chat must not outlive its schema.
  store.fieldAssist.value = { ...store.IDLE_ASSIST, forKey: null };
  store.startDraft(schema?.name ?? '', withKeys(schema?.content || []));
  store.rowErrors.value = new Map();
  store.generalErrors.value = [];
}

// Bumped on every openQueue: a response for a queue that is no longer the current one is
// dropped, or queue A's schema would show (and save) under queue B.
let openSeq = 0;

export async function openQueue(id: number) {
  const schemaId = idFromUrl(store.queues.value.find((x) => x.id === id)?.schema);
  return load(id, schemaId == null ? null : Number(schemaId));
}

/** Open a schema directly — the way in for a schema no queue uses. */
export async function openSchema(schemaId: number) {
  return load(null, schemaId);
}

/** Drop everything that belonged to the open queue or schema. */
function clearOpen() {
  // Mr. Fabry and the validation panel stay open for the next schema; the rest belong to this one.
  const kind = store.rightPanel.value?.kind;
  if (kind !== 'fabry' && kind !== 'validation') store.rightPanel.value = null;
  store.hooks.value = [];
  // A new schema, a new conversation: Mr. Fabry's context and its row keys belong to the old one.
  assistSeq.schema++;
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
  clearAnnotation();
  store.annotations.value = [];
  store.rules.value = [];
  store.ruleId.value = null;
  store.selectedKey.value = null;
  store.engineState.value = null;
  store.engineUsers.value = null;
  store.onlyWarnings.value = false;
  store.schema.value = null;
}

async function load(queueId: number | null, schemaId: number | null) {
  if (store.dirty.value && !confirm('Discard the staged changes to this schema?')) return;
  if (!leaveEditors()) return;
  const seq = ++openSeq;
  clearOpen();
  store.selectedQueueId.value = queueId;
  store.selectedSchemaId.value = schemaId;
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
      loadHooks(queueId);
      loadEngine(queueId);
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
    // Local checks, the stale check, engine field creates and patches, the schema, then
    // engine field deletes: the API refuses a datapoint without its engine field, and the
    // delete of an engine field a saved schema still uses.
    const r =
      localStage(store.work.value, store.draftName.value) ??
      engineLocalStage() ??
      (await saveSchema(
        {
          schemaId: schema.id,
          baseModifiedAt: schema.modified_at ?? null,
          work: store.work.value,
          force,
          name: store.draftName.value,
          baseName: store.baseName.value,
          beforeWrite: writeEngineFields,
        },
        api,
      ));
    const { byRow, general } = errorsByRow(r.ok ? [] : r.errors);
    if (r.ok) {
      const deleteError = await deleteEngineFields();
      const marks = store.engineDeletes.value;
      const sel = store.selectedKey.value;
      const selectedId = sel == null ? undefined : findByKey(store.work.value, sel)?.id;
      setBase(r.schema);
      // setBase renumbers the row keys: keep the selection on its field (ids are unique);
      // the rows Mr. Fabry touched are saved now.
      store.selectedKey.value =
        selectedId == null
          ? null
          : (flatten(store.work.value).find((x) => x.node.id === selectedId)?.key ?? null);
      store.fabryTouched.value = new Set();
      if (deleteError) {
        store.engineDeletes.value = marks;
        general.push(deleteError);
      }
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

// Fills the picker. A failure leaves it empty; pasting an ID still works.
async function loadAnnotations(queueId: number) {
  try {
    const page = await api.listAnnotations(queueId);
    if (store.selectedQueueId.value !== queueId) return;
    store.annotations.value = annotationRows(page);
  } catch (err: any) {
    if (isRateLimited(err)) fail(err, '');
    store.annotations.value = [];
  }
}

// Fills the Matching column. A failure leaves it empty.
async function loadHooks(queueId: number) {
  try {
    const list = await api.listHooks(queueId);
    if (store.selectedQueueId.value !== queueId) return;
    store.hooks.value = list;
  } catch (err: any) {
    if (isRateLimited(err)) fail(err, '');
    store.hooks.value = [];
  }
}

// Fills the rule picker. A failure leaves it empty (the picker then says so).
async function loadRules(queueId: number) {
  try {
    const list = await api.listRules(queueId);
    if (store.selectedQueueId.value !== queueId) return;
    store.rules.value = list;
  } catch (err: any) {
    if (isRateLimited(err)) fail(err, '');
    store.rules.value = [];
  }
}

// The queue's engine; for a custom one also its engine fields. A failure shows on the badge.
async function loadEngine(queueId: number) {
  const q = store.queues.value.find((x) => x.id === queueId);
  const kind = engineKind(q);
  store.engineState.value = { kind, engine: null, fields: [], error: null };
  if (kind === 'custom' || kind === 'generic') loadCatalog();
  if (kind !== 'custom') return;
  try {
    const engine = await api.get(q!.engine);
    const fields = await api.listEngineFields(engine.id);
    if (store.selectedQueueId.value !== queueId) return;
    store.engineState.value = { kind, engine, fields, error: null };
  } catch (err: any) {
    if (store.selectedQueueId.value !== queueId) return;
    store.engineState.value = {
      kind,
      engine: null,
      fields: [],
      error: String(err?.message ?? err),
    };
  }
}

let catalogLoading = false;
async function loadCatalog() {
  if (catalogLoading || store.engineCatalog.value.length) return;
  catalogLoading = true;
  try {
    store.engineCatalog.value = await api.listPreTrainedFields();
  } catch (err: any) {
    // no catalog: the seed picker is empty, the AI-fields text box still works
    if (isRateLimited(err)) fail(err, '');
  } finally {
    catalogLoading = false;
  }
}

/** On a custom engine: stop on what the API would reject, before any request. */
function engineLocalStage(): SaveResult | null {
  const es = store.engineState.value;
  if (es?.kind !== 'custom') return null;
  const local = bindingErrors(store.work.value);
  if (local.length) return { ok: false, stage: 'local', errors: local };
  if (!es.engine) {
    return {
      ok: false,
      stage: 'engine',
      errors: [{ key: null, message: `The queue's engine did not load: ${es.error ?? ''}` }],
    };
  }
  return null;
}

/**
 * On a custom engine, after the stale check and before the schema: create and patch the
 * engine fields the schema needs. Returns a failed SaveResult, or null to go on.
 */
async function writeEngineFields(): Promise<SaveResult | null> {
  const es = store.engineState.value;
  if (es?.kind !== 'custom' || !es.engine) return null;
  const plan = store.enginePlanNow.value!;
  let failed: SaveResult | null = null;
  try {
    for (const body of plan.create) await api.createEngineField(body);
    for (const p of plan.patch) await api.patchEngineField(p.id, p.body);
  } catch (err: any) {
    if (isRateLimited(err)) throw err;
    failed = {
      ok: false,
      stage: 'engine',
      errors: [{ key: null, message: `Engine fields: ${err?.message ?? err}` }],
    };
  }
  // Re-read what landed, whether or not all of it did, so the next Save plans from there.
  const fields = await api.listEngineFields(es.engine.id);
  store.engineState.value = { ...es, fields };
  return failed;
}

/**
 * After the schema landed: delete the marked engine fields. Returns an error message, or
 * null. A 429 is reported here rather than thrown, since the schema is already saved.
 */
async function deleteEngineFields(): Promise<string | null> {
  const es = store.engineState.value;
  const doomed = store.engineDeletesNow.value;
  if (!es?.engine || !doomed.length) return null;
  try {
    for (const f of doomed) await api.deleteEngineField(f.id);
    return null;
  } catch (err: any) {
    return `Engine fields: ${errorText(err, String(err))}`;
  } finally {
    // Re-read what is left, whether or not every delete landed.
    const fields = await api.listEngineFields(es.engine.id).catch(() => null);
    if (fields) store.engineState.value = { ...es, fields };
  }
}

// ---- The right panel ---------------------------------------------------------------------
// One panel at a time (store.rightPanel). Opening one replaces the one open.

/** Show `panel` and select row `key` (the inspector shows a selected row when none is open). */
function showPanel(panel: store.RightPanel, key: string | null = null) {
  store.rightPanel.value = panel;
  store.selectedKey.value = key;
}

/** Close the panel if it is a `kind` one. */
function hidePanel(kind: store.RightPanel['kind']) {
  if (store.rightPanel.value?.kind === kind) store.rightPanel.value = null;
}

/**
 * Close an open rule or hook editor before something replaces it, asking first when it holds
 * unsaved changes. False: the user kept it open.
 */
function leaveEditors(): boolean {
  if (store.ruleEditor.value) closeRuleEditor();
  else if (store.hookEditor.value) closeHookEditor();
  return !store.ruleEditor.value && !store.hookEditor.value;
}

/** Esc: close whichever panel is open. */
export function closeRightPanel() {
  const close = {
    fabry: closeSchemaFabry,
    validation: closeValidationPanel,
    rule: closeRuleEditor,
    hook: closeHookEditor,
    code: closeCodeView,
    engine: closeEnginePanel,
  };
  const kind = store.rightPanel.value?.kind;
  if (kind) close[kind]();
}

/** Show a hook read-only in the right panel, at the first place it mentions the field. */
export function openCodeView(hookId: number, fieldId: string) {
  if (leaveEditors()) showPanel({ kind: 'code', hookId, fieldId });
}

export function closeCodeView() {
  hidePanel('code');
}

/** The engine panel; `key` selects that row (a click on its AI cell). Custom engine only. */
export function openEnginePanel(key?: string) {
  if (store.engineState.value?.kind !== 'custom' || !leaveEditors()) return;
  showPanel({ kind: 'engine' }, key ?? null);
  if (!store.engineUsers.value) loadEngineUsers();
}

// The other queues bound to this engine, and the engine fields their schemas use.
async function loadEngineUsers() {
  const es = store.engineState.value;
  const queueId = store.selectedQueueId.value;
  const mine = store.selectedQueue.value?.schema;
  if (!es?.engine) return;
  store.engineUsers.value = { byName: null, error: null };
  const bySchema = otherEngineQueues(store.queues.value, es.engine.url, queueId, mine);
  try {
    const loaded = await Promise.all(
      [...bySchema.keys()].map(async (url) => ({
        url,
        schema: await api.getSchema(Number(idFromUrl(url))),
      })),
    );
    if (store.selectedQueueId.value !== queueId) return;
    const byName = engineFieldUsers(
      loaded.flatMap(({ url, schema }) =>
        bySchema
          .get(url)!
          .map((q) => ({ queue: `${q.name} (${q.id})`, content: schema.content ?? [] })),
      ),
    );
    store.engineUsers.value = { byName, error: null };
  } catch (err: any) {
    if (store.selectedQueueId.value !== queueId) return;
    store.engineUsers.value = { byName: null, error: String(err?.message ?? err) };
  }
}

/** Mark an engine field no queue uses for deletion on Save, or keep it again. */
export function toggleEngineDelete(id: number) {
  const next = new Set(store.engineDeletes.value);
  if (!next.delete(id)) next.add(id);
  store.engineDeletes.value = next;
}

/** Closing also drops the selection, so the field panel does not take the engine's place. */
export function closeEnginePanel() {
  hidePanel('engine');
  store.selectedKey.value = null;
}

let pickSeq = 0;

export function clearAnnotation() {
  pickSeq++;
  store.validation.value = null;
  store.revalidateError.value = null;
  store.annotationContent.value = [];
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
  store.annotationContent.value = []; // the old annotation's, until the new one loads
  store.validation.value = null;
  store.revalidateError.value = null;
  store.annotationError.value = null;
  store.lineRow.value = {};
  try {
    const data = await api.getAnnotationContent(id);
    if (seq !== pickSeq) return;
    store.annotationContent.value = data?.content || [];
    store.values.value = annotationValues(data?.content || []);
  } catch (err: any) {
    if (seq !== pickSeq) return;
    store.values.value = null;
    store.annotationError.value = errorText(err, 'Failed to load the annotation');
  }
}

// ---- Creating and deleting workspaces, queues and schemas -------------------------------
// These act at once, after a confirmation for deletes: they are not staged with Save.

async function refreshLists() {
  await Promise.all([loadQueues(), loadSchemas()]);
}

// The organization a new workspace belongs to: the one the existing workspaces are in, or
// the session's organization (currentOrg — not auth/user's HOME org).
async function organizationUrl(): Promise<string> {
  const known = store.workspaces.value.find((w) => w.organization)?.organization;
  if (known) return known;
  const org = currentOrg(await api.get('/api/v1/organizations/'));
  if (org?.id != null) return `${store.domain.value}/api/v1/organizations/${org.id}`;
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
  clearOpen();
  store.rightPanel.value = null;
  store.selectedQueueId.value = null;
  store.selectedSchemaId.value = null;
  setBase(null);
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
  if (!leaveEditors()) return;
  const rule = id == null ? null : store.rules.value.find((r) => r.id === id);
  const draft = rule ? draftFromRule(rule) : emptyDraft(fieldId);
  showPanel({
    kind: 'rule',
    editor: {
      ruleId: rule ? rule.id : null,
      base: draft,
      draft,
      fromField: rule ? null : (fieldId ?? null),
    },
  });
  assistSeq.rule++;
  store.assist.value = store.IDLE_ASSIST;
  store.ruleErrors.value = [];
  if (rule) store.ruleId.value = rule.id;
}

export function updateRuleDraft(patch: Partial<RuleDraft>) {
  const ed = store.ruleEditor.value;
  if (!ed) return;
  store.rightPanel.value = { kind: 'rule', editor: { ...ed, draft: { ...ed.draft, ...patch } } };
}

// The open rule on the picked annotation, through Rossum's preview endpoint. Debounced: the
// rule editor calls this on every change of the condition, the actions or the annotation.
const RULE_EVAL_DELAY_MS = 400;
let ruleEvalTimer: ReturnType<typeof setTimeout> | undefined;
let ruleEvalSeq = 0;

export function scheduleRuleEval() {
  clearTimeout(ruleEvalTimer);
  ruleEvalSeq++;
  const ed = store.ruleEditor.value;
  const queueUrl = store.selectedQueue.value?.url;
  const id = store.annotationId.value;
  if (!ed?.draft.trigger_condition.trim() || !queueUrl || id == null) {
    store.ruleEval.value = null;
    return;
  }
  if (!store.annotationContent.value.length) return; // its content is still loading
  const prev = store.ruleEval.value;
  store.ruleEval.value = { values: prev?.values ?? [], errors: [], busy: true, error: null };
  const seq = ruleEvalSeq;
  ruleEvalTimer = setTimeout(async () => {
    const annotationUrl = `${store.domain.value}/api/v1/annotations/${id}`;
    try {
      const res = await api.evaluateRules(
        ruleEvalBody(ed.draft, queueUrl, annotationUrl, store.annotationContent.value),
      );
      if (seq !== ruleEvalSeq) return;
      store.ruleEval.value = { ...parseRuleEval(res), busy: false, error: null };
    } catch (err: any) {
      if (seq !== ruleEvalSeq) return;
      const msg = errorText(err, 'Evaluation failed');
      store.ruleEval.value = { values: [], errors: [], busy: false, error: msg };
    }
  }, RULE_EVAL_DELAY_MS);
}

export function closeRuleEditor() {
  if (store.ruleDirty.value && !confirm('Discard the unsaved changes to this rule?')) return;
  hidePanel('rule');
  store.ruleErrors.value = [];
  store.ruleId.value = null;
  scheduleRuleEval();
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
    // Like the schema's stale check: a PATCH would overwrite another user's change unseen.
    if (ed.ruleId != null) {
      const current = await api.getRule(ed.ruleId);
      const opened = store.rules.value.find((r) => r.id === ed.ruleId);
      if (current?.modified_at !== opened?.modified_at) {
        store.ruleErrors.value = [
          'Someone changed this rule after you opened it. Reopen the queue to load their version.',
        ];
        return;
      }
    }
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
    if (store.ruleEditor.value?.ruleId === ed.ruleId) {
      store.rightPanel.value = {
        kind: 'rule',
        editor: { ruleId: saved?.id ?? ed.ruleId, base: draft, draft },
      };
    }
    if (saved?.id != null) store.ruleId.value = saved.id;
  } catch (err: any) {
    store.ruleErrors.value = [errorText(err, 'Failed to save the rule')];
  } finally {
    store.ruleSaving.value = false;
  }
}

/** Put the open rule back as it was opened (or last saved). */
export function discardRule() {
  const ed = store.ruleEditor.value;
  if (!ed) return;
  store.rightPanel.value = { kind: 'rule', editor: { ...ed, draft: ed.base } };
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
  await assistTurn('rule', {
    chatId: prev.chatId,
    content,
    stillOpen: () => !!store.ruleEditor.value, // closed or replaced meanwhile
    onReply: ({ chatId, text }) => {
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
        warnings: r.unknownFields.length
          ? [`Not in this schema: ${r.unknownFields.join(', ')}`]
          : [],
      };
    },
    onError: (error) => (store.assist.value = { ...store.assist.value, busy: false, error }),
  });
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
  await assistTurn('field', {
    chatId,
    content,
    onReply: (res) => {
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
    },
    onError: (error) =>
      (store.fieldAssist.value = { ...store.fieldAssist.value, busy: false, error }),
  });
}

// ---- Mr. Fabry for the whole schema --------------------------------------------------------

export function openSchemaFabry() {
  if (leaveEditors()) showPanel({ kind: 'fabry' });
}

export function closeSchemaFabry() {
  hidePanel('fabry');
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
  const you = { role: 'you' as const, text: fix ? 'Fix the problems above.' : request };
  store.schemaFabry.value = { ...st, busy: true, error: null, turns: [...st.turns, you] };
  await assistTurn('schema', {
    chatId: st.chatId,
    content: fitted.prompt,
    onReply: async (res, current) => {
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
      const errs = localErrors(r.nodes);
      let unvalidated: string | null = null;
      const sch = store.schema.value;
      if (!errs.length && sch) {
        try {
          const verdict = await api.validateSchema(sch.id, stripForSave(r.nodes));
          if (verdict && Object.keys(verdict).length)
            errs.push(...mapValidateErrors(verdict, r.nodes));
        } catch (err: any) {
          unvalidated = `Could not validate: ${err?.message || 'unknown error'}`;
        }
        if (!current()) return;
      }
      const problems = problemList(r, unvalidated, errs);
      store.rowErrors.value = errorsByRow(errs).byRow;
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
    },
    onError: (error) =>
      (store.schemaFabry.value = { ...store.schemaFabry.value, busy: false, error }),
  });
}

/** Send exactly the problems left by the last answer back to the same chat. */
export function fixWithFabry() {
  const problems = store.schemaFabry.value.problems;
  if (problems.length) return askSchemaFabry('', problems);
  return Promise.resolve();
}

// ---- Hook mode (MDH) -----------------------------------------------------------------------
// The right panel edits one MDH hook's settings as JSON. A hook is its own object in Rossum:
// its own Save (PATCH settings), separate from the schema and from rules.

const pretty = (v: unknown) => JSON.stringify(v ?? {}, null, 2);

export function openHookEditor(id: number) {
  const hook = store.hooks.value.find((h) => h.id === id);
  if (!hook || !leaveEditors()) return;
  const text = pretty(hook.settings);
  showPanel({ kind: 'hook', editor: { hookId: id, base: text, draft: text } });
  store.hookConfigIndex.value = null;
  store.hookErrors.value = [];
  assistSeq.hook++;
  store.hookAssist.value = store.IDLE_ASSIST;
}

export function updateHookDraft(text: string) {
  const ed = store.hookEditor.value;
  if (ed) store.rightPanel.value = { kind: 'hook', editor: { ...ed, draft: text } };
}

export function closeHookEditor() {
  if (store.hookDirty.value && !confirm('Discard the unsaved changes to this hook?')) return;
  hidePanel('hook');
  store.hookErrors.value = [];
}

export function discardHook() {
  const ed = store.hookEditor.value;
  if (!ed) return;
  store.rightPanel.value = { kind: 'hook', editor: { ...ed, draft: ed.base } };
  store.hookErrors.value = [];
  store.hookAssistRev.value++;
}

export async function saveHook() {
  const ed = store.hookEditor.value;
  if (!ed) return;
  const parsed = parseSettings(ed.draft);
  if (!parsed.ok) {
    store.hookErrors.value = [parsed.error];
    return;
  }
  store.hookErrors.value = [];
  store.hookSaving.value = true;
  try {
    // Like the schema's stale check: the PATCH replaces the whole settings object.
    const current = await api.getHook(ed.hookId);
    const opened = store.hooks.value.find((h) => h.id === ed.hookId);
    if (current?.modified_at !== opened?.modified_at) {
      store.hookErrors.value = [
        'Someone changed this hook after you opened it. Reopen the queue to load their version.',
      ];
      return;
    }
    const saved = await api.patchHookSettings(ed.hookId, parsed.value);
    const settings = saved?.settings ?? parsed.value;
    const modified_at = saved?.modified_at ?? opened?.modified_at;
    store.hooks.value = store.hooks.value.map((h) =>
      h.id === ed.hookId ? { ...h, settings, modified_at } : h,
    );
    const text = pretty(settings);
    if (store.hookEditor.value?.hookId === ed.hookId) {
      store.rightPanel.value = {
        kind: 'hook',
        editor: { hookId: ed.hookId, base: text, draft: text },
      };
    }
    store.hookAssistRev.value++;
  } catch (err: any) {
    store.hookErrors.value = [errorText(err, 'Failed to save the hook')];
  } finally {
    store.hookSaving.value = false;
  }
}

/** Ask Mr. Fabry to change the hook's settings; a usable answer fills the editor, unsaved. */
export async function askHookAssistant(request: string) {
  const ed = store.hookEditor.value;
  const prev = store.hookAssist.value;
  if (!ed || !request.trim() || prev.busy) return;
  const hook = store.hooks.value.find((h) => h.id === ed.hookId);
  const settings = store.hookLive.value?.settings;
  const fields = schemaFieldList(store.work.value);
  const content = prev.chatId
    ? buildHookFollowup(request, settings)
    : buildHookPrompt({ request, settings, fields, name: String(hook?.name ?? '') });
  store.hookAssist.value = { ...prev, busy: true, error: null, reply: null, warnings: [] };
  await assistTurn('hook', {
    chatId: prev.chatId,
    content,
    stillOpen: () => !!store.hookEditor.value,
    onReply: (res) => {
      const r = parseHookReply(res.text, new Set(fields.map((f) => f.id)));
      if (!r.ok) {
        store.hookAssist.value = {
          chatId: res.chatId,
          busy: false,
          error: r.error,
          reply: res.text,
          warnings: [],
        };
        return;
      }
      updateHookDraft(pretty(r.settings));
      store.hookAssistRev.value++;
      store.hookAssist.value = {
        chatId: res.chatId,
        busy: false,
        error: null,
        reply: null,
        warnings: r.warnings,
      };
    },
    onError: (error) =>
      (store.hookAssist.value = { ...store.hookAssist.value, busy: false, error }),
  });
}

// ---- Revalidate -------------------------------------------------------------------------
// Validate the picked annotation as a reviewer's edit would — formulas, hooks and rules run —
// without changing a value. A document in `to_review` is started (locked to this user) and
// handed back afterwards; one already in review is left as it is (revalidateStart).

export async function revalidate() {
  const id = store.annotationId.value;
  if (id == null || store.revalidating.value) return;
  const seq = pickSeq;
  store.revalidating.value = true;
  store.revalidateError.value = null;
  let started = false;
  try {
    const ann = await api.getAnnotation(id);
    const plan = revalidateStart(String(ann?.status ?? ''));
    if (!plan.ok) {
      store.revalidateError.value = plan.error;
      return;
    }
    if (plan.start) {
      await api.startAnnotation(id);
      started = true;
    }
    const res = await api.validateAnnotation(id);
    const content = await api.getAnnotationContent(id);
    if (seq !== pickSeq) return; // another annotation was picked meanwhile
    store.annotationContent.value = content?.content || [];
    const values = annotationValues(content?.content || []);
    store.values.value = values;
    store.validation.value = {
      placed: placeMessages(res?.messages, values.ids),
      fired: firedRuleIds(res?.matched_trigger_rules),
      raw: res,
    };
    openValidationPanel('rules');
  } catch (err: any) {
    store.revalidateError.value = errorText(err, 'Revalidation failed');
  } finally {
    if (started) {
      try {
        await api.cancelAnnotation(id);
      } catch (err: any) {
        store.revalidateError.value = `Validated, but the document could not be handed back: ${err?.message || 'error'}`;
      }
    }
    store.revalidating.value = false;
  }
}

// ---- Validation panel ----------------------------------------------------------------------

/** Show the results in the right panel — unless an edited rule or hook is open there. */
export function openValidationPanel(tab: 'rules' | 'provenance' = 'rules') {
  if (store.ruleDirty.value || store.hookDirty.value) return; // keep unsaved work in view
  leaveEditors();
  showPanel({ kind: 'validation', tab });
}

export function closeValidationPanel() {
  hidePanel('validation');
}

const FLASH_ROW_MS = 1200;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Scroll the grid to a row and flash it (a jump from the validation panel). */
export function revealRow(key: string) {
  const el = document.querySelector(`[data-row-key="${key}"]`) as HTMLElement | null;
  el?.scrollIntoView?.({ block: 'center' });
  store.flashRowKey.value = key;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (store.flashRowKey.value = null), FLASH_ROW_MS);
}
