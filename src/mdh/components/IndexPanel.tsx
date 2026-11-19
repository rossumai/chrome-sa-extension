import { h, Fragment } from 'preact';
import { useState, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
// Aliased: useOperationStatus() also returns a `track`, which would shadow this
// one and silently send the event into the async-operation poller instead.
import { track as trackUsage } from '../../usage/track.js';
import { selectedCollection, activePanel, loading, error } from '../store.js';
import {
  openModal,
  closeModal,
  ModalBody,
  ModalActions,
  ModalField,
  ModalFieldLabel,
} from './Modal.jsx';
import JsonEditor from './JsonEditor.jsx';
import IndexCard from './IndexCard.jsx';
import { Segmented } from './ImportControls.jsx';
import {
  toCreateIndexDefinition,
  classifyIndexType,
  redundantIndexNames,
  formatBytes,
  collectionIndexSummary,
  coveringWildcardIndex,
} from '../indexDef.js';
// Generic despite the module it lives in: it lifts `indexName`/`name` out of a
// pasted definition and hands back the rest. Reused rather than duplicated so
// both index modals tolerate the same saved snippets, and it is already tested.
import { splitPastedDefinition } from '../searchIndexDef.js';
import {
  customPreset,
  lookupKeyPreset,
  matchingCascadePreset,
  uniqueKeyPreset,
  expiringPreset,
  isSingleFieldPreset,
  fieldRowLabel,
} from '../indexPresets.js';
import type { IndexPresetId } from '../indexPresets.js';
import useOperationStatus from '../hooks/useOperationStatus.js';
import * as api from '../api.js';
import * as cache from '../cache.js';
import type { JsonEditorHandle } from './JsonEditor.jsx';
import MatchKeyPicker from './MatchKeyPicker.jsx';
import { discoverLeafPaths } from '../columnDiscovery.js';
import styles from './IndexBuilder.module.css';
import ctl from '../../ui/controls.module.css';

function defaultTemplate() {
  // One definition of the minimal template, shared with the Custom tab.
  return JSON.stringify(customPreset(), null, 2);
}

// Lookup key and Expiring each keep only the FIRST field the picker holds
// (see indexPresets.ts), so picking order is inert for them — the hint below
// must render only for the two presets where a multi-field key actually
// reaches the definition.
const ORDER_MATTERS_PRESETS = new Set<IndexPresetId>(['cascade', 'unique']);

export default function IndexPanel() {
  const [indexes, setIndexes] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const { track, clear } = useOperationStatus();

  async function loadIndexes() {
    const collection = selectedCollection.value as string;
    if (!collection) return;

    const cached = cache.get(collection, 'indexes');
    if (cached !== null) {
      setIndexes(cached);
      return;
    }

    const isVisible = activePanel.value === 'indexes';
    try {
      if (isVisible) {
        loading.value = true;
        error.value = null;
      }
      const res = await api.listIndexes(collection, false);
      const result = res.result || [];
      cache.set(collection, 'indexes', result);
      if (isVisible) loading.value = false;
      if (selectedCollection.value !== collection) return;
      setIndexes(result);
    } catch (err: any) {
      if (isVisible) {
        error.value = { message: err.message };
        loading.value = false;
      }
    }
  }

  // Best-effort: per-index sizes + collection totals via $collStats. Never
  // surfaces an error — size display is purely additive (and $collStats may be
  // unavailable on some environments).
  async function loadStats() {
    const collection = selectedCollection.value as string;
    if (!collection) return;
    const cached = cache.get(collection, 'collStats');
    if (cached !== null) {
      setStats(cached);
      return;
    }
    try {
      const res = await api.collectionStats(collection);
      const s = res.result?.[0] || null;
      cache.set(collection, 'collStats', s);
      if (selectedCollection.value === collection) setStats(s);
    } catch {
      /* size display is optional */
    }
  }

  // Re-list indexes and refresh sizes — run once an async op actually finishes.
  function reloadAll() {
    loadIndexes();
    loadStats();
  }

  // Reset on collection/panel switch — including clearing any in-flight op poll
  // so a previous collection's operation can't surface its result under another.
  useEffect(() => {
    clear();
    setStats(null);
    loadIndexes();
    loadStats();
  }, [selectedCollection.value, activePanel.value]);

  function openCreateModal(hasWildcard: boolean) {
    const editorRef: { current: JsonEditorHandle | null } = { current: null };

    openModal('Create Index', () => {
      const hintRef = useRef<HTMLDivElement | null>(null);
      // Uncontrolled, and never auto-filled from a preset: Preact's controlled
      // diffing compares `value` against the LIVE DOM value and this closure
      // re-renders on every tab change, which would reset a name mid-typing.
      // Matches the search-index modal, including the reason a preset does not
      // suggest a name — it would go stale the moment the fields change.
      const nameRef = useRef<HTMLInputElement | null>(null);
      // Opens on Custom, matching the editor's own seed, so the tab reflects
      // what is actually in the box rather than leaving both unset.
      const [preset, setPreset] = useState<IndexPresetId | null>('custom');
      const [pendingPreset, setPendingPreset] = useState<IndexPresetId | null>(null);
      // The exact string the last tab wrote. Anything else is the user's own
      // work, and replacing it has to be asked about first — the sibling
      // search-index modal has guarded this since it gained presets, and making
      // Custom clickable is what makes the hazard reachable here.
      const lastPresetJson = useRef<string | null>(defaultTemplate());
      const [fields, setFields] = useState<string[]>([]);
      const [paths, setPaths] = useState<{ loading: boolean; value: string[] | null }>({
        loading: false,
        value: null,
      });

      useEffect(() => {
        // Guard on paths.value ONLY, not paths.loading: a preset switch aborts
        // the in-flight call and immediately re-runs this effect (same tick),
        // while the aborted call's own .then/.catch — which would flip
        // paths.loading back to false — only fires later, as a microtask. If
        // the guard also checked paths.loading, that stale `true` would block
        // the new preset's request from ever starting, and once the aborted
        // call's catch does land, nothing re-triggers this effect (its
        // dependency is only `preset`) — permanently stranding the picker on
        // the free-text fallback for the rest of the modal session. `active`
        // instead scopes staleness to THIS run, so an aborted call's settled
        // promise can never clobber a newer run's state.
        // Custom is the opening state and generates nothing from fields, so it
        // must not trigger discovery — otherwise merely opening the modal fires
        // an aggregate, which this panel has never done.
        if (!preset || preset === 'custom' || paths.value) return undefined;
        const controller = new AbortController();
        let active = true;
        setPaths({ loading: true, value: null });
        discoverLeafPaths(selectedCollection.value as string, [], {
          aggregate: api.aggregate,
          signal: controller.signal,
        })
          .then((found) => {
            if (active) setPaths({ loading: false, value: found });
          })
          .catch(() => {
            if (active) setPaths({ loading: false, value: null });
          });
        return () => {
          active = false;
          controller.abort();
        };
      }, [preset]);

      // useLayoutEffect, not useEffect: Preact flushes useEffect after paint, so the
      // editor's contents could lag a Submit click. "The editor always shows what will
      // be sent" is a same-commit requirement.
      useLayoutEffect(() => {
        if (preset && preset !== 'custom') writePreset(preset, fields);
      }, [fields]);

      // Explicit per id, never a fall-through: the previous form ended in an
      // unguarded `return expiringPreset(...)`, so any id it did not name would
      // have silently produced a TTL index instead of the one selected.
      function definitionFor(id: IndexPresetId, picked: string[]) {
        if (id === 'custom') return customPreset();
        if (id === 'lookup') return lookupKeyPreset(picked);
        if (id === 'cascade') return matchingCascadePreset(picked);
        if (id === 'unique') return uniqueKeyPreset(picked);
        return expiringPreset(picked[0] || 'created_at', 2592000);
      }

      function writePreset(id: IndexPresetId, picked: string[]) {
        // Switching to a single-field preset drops the extra chips instead of
        // keeping them and quietly ignoring them — the chips disappearing IS the
        // explanation, and it needs no reading.
        const kept = isSingleFieldPreset(id) ? picked.slice(0, 1) : picked;
        if (kept.length !== picked.length) setFields(kept);
        const json = JSON.stringify(definitionFor(id, kept), null, 2);
        editorRef.current?.setValue(json);
        lastPresetJson.current = json;
        setPreset(id);
        setPendingPreset(null);
      }

      // Untouched means: blank, or still exactly what the last tab wrote. The
      // seed counts because lastPresetJson is initialised to it.
      function isEditorUntouched() {
        const current = (editorRef.current?.getValue() || '').trim();
        return current === '' || current === (lastPresetJson.current || '').trim();
      }

      // NOT confirmModal: `modalContent` is a single signal, so a confirm dialog
      // REPLACES this modal and destroys the editor contents the guard exists to
      // protect. The confirmation is inline, in the tab row's place.
      function choosePreset(id: IndexPresetId) {
        if (isEditorUntouched()) writePreset(id, fields);
        else setPendingPreset(id);
      }

      async function handleCreate() {
        if (!editorRef.current?.isValid()) {
          if (hintRef.current) hintRef.current.textContent = 'Invalid JSON';
          return;
        }
        // A snippet copied from this panel — or from the build that kept the name
        // inside the JSON — still pastes: the name is lifted out and offered to the
        // input rather than rejected.
        const split = splitPastedDefinition(editorRef.current.getParsed());
        if (split.name && nameRef.current && !nameRef.current.value.trim()) {
          nameRef.current.value = split.name;
        }
        const indexName = (nameRef.current?.value || '').trim();
        if (!indexName) {
          if (hintRef.current) hintRef.current.textContent = 'A name is required';
          nameRef.current?.focus();
          return;
        }
        const { keys, options: opts } = split.definition || {};
        if (!keys) {
          if (hintRef.current) hintRef.current.textContent = 'The definition needs a "keys" object';
          return;
        }
        // A preset with no field chosen writes `keys: {}` into the editor,
        // and `{}` is truthy — the check above lets it through. An empty key
        // spec is not a valid index (the old hand-typed placeholder always
        // shipped { field: 1 }), so refuse it here rather than letting the
        // API reject it.
        if (typeof keys !== 'object' || Object.keys(keys).length === 0) {
          if (hintRef.current) hintRef.current.textContent = 'keys must include at least one field';
          return;
        }

        try {
          loading.value = true;
          error.value = null;
          trackUsage('sa_mdh_index_create');
          const res = await api.createIndex(
            selectedCollection.value as string,
            indexName,
            keys,
            opts || {},
          );
          cache.invalidate(selectedCollection.value as string, 'indexes');
          cache.invalidate(selectedCollection.value as string, 'collStats');
          loading.value = false;
          closeModal();
          const opId = res.operationId;
          if (opId) track(opId, { label: `Creating index "${indexName}"`, onFinished: reloadAll });
          else reloadAll();
        } catch (err: any) {
          loading.value = false;
          if (hintRef.current) hintRef.current.textContent = err.message;
        }
      }

      return (
        <>
          <ModalBody stable>
            <ModalField label="Name">
              <input ref={nameRef} class="input" style="width:100%" placeholder="my_index" />
            </ModalField>
            {/* The confirm renders BELOW the tabs rather than replacing them: swapping
              a component for an element in the same slot remounts the JSON editor
              further down the tree, which re-seeds it from `value` and destroys the
              very edits "Keep mine" promises to keep. Verified by instance-tracking
              the editor across the swap. Keeping the tab row mounted also lets the
              reader see which tab they are on while deciding. */}
            <ModalField label="Start from">
              <Segmented
                testid="index-preset-row"
                ariaLabel="Start from"
                value={preset || undefined}
                onChange={choosePreset}
                tabs
                options={[
                  { value: 'custom', label: 'Custom', testid: 'preset-custom' },
                  ...(hasWildcard
                    ? []
                    : [{ value: 'lookup', label: 'Lookup key', testid: 'preset-lookup' }]),
                  { value: 'cascade', label: 'Matching cascade', testid: 'preset-cascade' },
                  { value: 'unique', label: 'Unique key', testid: 'preset-unique' },
                  { value: 'expiring', label: 'Expiring', testid: 'preset-expiring' },
                ]}
              />
            </ModalField>
            {pendingPreset && (
              <div class={styles.presetConfirm}>
                <span>Replace your edits with this preset?</span>
                <button
                  class={`${ctl.btn} ${ctl.btnSm} ${ctl.btnPrimary}`}
                  onClick={() => writePreset(pendingPreset, fields)}
                >
                  Replace
                </button>
                <button class={`${ctl.btn} ${ctl.btnSm}`} onClick={() => setPendingPreset(null)}>
                  Keep mine
                </button>
              </div>
            )}
            {preset && preset !== 'custom' && (
              <div class={styles.presetRow}>
                <ModalFieldLabel>{fieldRowLabel(preset)}</ModalFieldLabel>
                {paths.value ? (
                  <div data-testid="index-field-picker">
                    <MatchKeyPicker
                      paths={paths.value}
                      keys={fields}
                      setKeys={setFields}
                      single={isSingleFieldPreset(preset)}
                    />
                  </div>
                ) : paths.loading ? (
                  <div class={styles.pickerHint}>Reading field names{'…'}</div>
                ) : (
                  <input
                    data-testid="index-field-fallback"
                    class="input"
                    style="width:100%"
                    placeholder="field path"
                    onChange={(e: any) => setFields(e.target.value ? [e.target.value.trim()] : [])}
                  />
                )}
                {preset && ORDER_MATTERS_PRESETS.has(preset) && (
                  <div class={styles.pickerHint}>
                    Order matters for a compound index: put the fields you match exactly first, then
                    the one you sort or range over.
                  </div>
                )}
              </div>
            )}
            <JsonEditor value={defaultTemplate()} minHeight="160px" fill editorRef={editorRef} />
            <div ref={hintRef} class="input-hint"></div>
          </ModalBody>
          <ModalActions footer>
            <button class={`${ctl.btn} ${ctl.btnSecondary}`} onClick={closeModal}>
              Cancel
            </button>
            <button class={`${ctl.btn} ${ctl.btnPrimary}`} onClick={handleCreate}>
              Create Index
            </button>
          </ModalActions>
        </>
      );
    });
  }

  async function doDropIndex(indexName: any) {
    try {
      loading.value = true;
      error.value = null;
      const res = await api.dropIndex(selectedCollection.value as string, indexName);
      cache.invalidate(selectedCollection.value as string, 'indexes');
      cache.invalidate(selectedCollection.value as string, 'collStats');
      loading.value = false;
      const opId = res.operationId;
      if (opId) track(opId, { label: `Dropping index "${indexName}"`, onFinished: reloadAll });
      else reloadAll();
    } catch (err: any) {
      error.value = { message: err.message };
      loading.value = false;
    }
  }

  const redundant = redundantIndexNames(indexes);
  const summary = collectionIndexSummary(indexes);
  const hasWildcard = coveringWildcardIndex(indexes) !== null;
  const indexSizes = stats?.indexSizes || {};
  const metaLabel = stats
    ? [
        stats.count != null ? `${stats.count.toLocaleString('en-US')} docs` : null,
        stats.totalIndexSize != null ? formatBytes(stats.totalIndexSize) : null,
      ]
        .filter(Boolean)
        .join(' \u00b7 ')
    : '';

  return (
    <div class="panel">
      <div class="toolbar">
        <span style="flex:1;font-weight:500">
          Indexes{metaLabel ? <span class="panel-meta">{metaLabel}</span> : null}
        </span>
        <button
          class={`${ctl.btn} ${ctl.btnSuccess} ${ctl.btnSm}`}
          onClick={() => openCreateModal(hasWildcard)}
        >
          + Create
        </button>
        <button
          class={ctl.iconBtn}
          title="Refresh"
          onClick={() => {
            cache.invalidate(selectedCollection.value as string, 'indexes');
            cache.invalidate(selectedCollection.value as string, 'collStats');
            loadIndexes();
            loadStats();
          }}
        >
          {'\u21bb'}
        </button>
      </div>
      {summary && (
        <div data-testid="index-summary" class={styles.summary}>
          {summary}
        </div>
      )}
      <div class="index-list">
        {indexes.length === 0 ? (
          <div style="padding:16px;color:var(--text-secondary);font-size:12px">No indexes</div>
        ) : (
          indexes.map((idx) => {
            const isObj = typeof idx === 'object' && idx !== null;
            const name = isObj ? idx.name || '(unnamed)' : String(idx);
            const isDefault = name === '_id_';
            const badges = [];
            if (isDefault) badges.push({ text: 'default', cls: 'index-badge-default' });
            if (isObj && idx.unique) badges.push({ text: 'unique', cls: 'index-badge-unique' });
            if (isObj && idx.sparse) badges.push({ text: 'sparse' });
            if (isObj && idx.expireAfterSeconds != null)
              badges.push({ text: `TTL: ${idx.expireAfterSeconds}s` });
            const type = isObj ? classifyIndexType(idx.key) : null;
            if (type && type !== 'single') badges.push({ text: type });
            if (redundant.has(name))
              badges.push({ text: 'redundant?', cls: 'index-badge-warning' });
            const sizeMeta = formatBytes(indexSizes[name]);
            return (
              <IndexCard
                name={name}
                badges={badges}
                definition={isObj ? toCreateIndexDefinition(idx) : null}
                meta={sizeMeta || null}
                canDrop={!isDefault}
                onDrop={() => doDropIndex(name)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
