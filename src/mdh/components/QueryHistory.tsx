import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import JSON5 from 'json5';
import { selectedCollection, scopeSuffix } from '../store.js';
import { parseEntries } from '../pipelineComments.js';
import { formatTime } from '../relativeTime.js';
import styles from './QueryHistory.module.css';

const MAX_HISTORY = 30;

// Saved / Recent queries are namespaced per organization (scopeSuffix) so they
// aren't shared across projects. Stored in chrome.storage.local.
async function readList(baseKey: string): Promise<any[]> {
  const key = `${baseKey}::${scopeSuffix()}`;
  return ((await chrome.storage.local.get(key))?.[key] as any[]) || [];
}

async function writeList(baseKey: string, list: any[]) {
  const key = `${baseKey}::${scopeSuffix()}`;
  await chrome.storage.local.set({ [key]: list });
}

// All history/saved writes are read-modify-write on a per-org array. Run them
// through a per-tab promise chain so overlapping writes within this tab can't
// lose an entry. (Cross-tab simultaneous writes remain a low-probability,
// accepted residual — see docs/superpowers/specs/2026-06-29-mdh-multitab-hardening-design.md.)
let writeChain = Promise.resolve();
function serialize(task: any) {
  const run = writeChain.then(task, task); // run regardless of the prior outcome
  writeChain = run.catch(() => {});
  return run;
}

// Normalize a pipeline string so cosmetic edits (whitespace, key order from
// JSON5 reformatting) don't create duplicate entries. Includes disabled-stage
// flags so a pipeline and its disabled-stage variant are stored separately.
// Falls back to the raw string if parsing fails.
function dedupKey(collection: any, pipeline: any) {
  let normalized = pipeline;
  try {
    const { entries, ok } = parseEntries(pipeline);
    if (ok)
      normalized = JSON.stringify(entries.map((e) => ({ d: e.disabled ? 1 : 0, s: e.stage })));
    else normalized = JSON.stringify(JSON5.parse(pipeline));
  } catch {
    /* keep raw */
  }
  return collection + '::' + normalized;
}

// `placeholderTypes` is optional, and guarded below — matching saveQuery, which has
// always declared the same trailing parameter optional.
export async function addToHistory(
  collection: any,
  pipeline: any,
  variables: any,
  placeholderTypes?: any,
) {
  return serialize(async () => {
    const queryHistory = await readList('queryHistory');
    const key = dedupKey(collection, pipeline);
    const filtered = queryHistory.filter((e) => dedupKey(e.collection, e.pipeline) !== key);
    const entry: any = { collection, pipeline, ts: Date.now() };
    if (variables && Object.keys(variables).length > 0) entry.variables = variables;
    if (placeholderTypes && Object.keys(placeholderTypes).length > 0)
      entry.placeholderTypes = placeholderTypes;
    filtered.unshift(entry);
    await writeList('queryHistory', filtered.slice(0, MAX_HISTORY));
  });
}

export async function saveQuery(
  collection: any,
  pipeline: any,
  name: any,
  variables: any,
  placeholderTypes?: any,
) {
  return serialize(async () => {
    const savedQueries = await readList('savedQueries');
    const entry: any = { collection, pipeline, name, ts: Date.now() };
    if (variables && Object.keys(variables).length > 0) entry.variables = variables;
    if (placeholderTypes && Object.keys(placeholderTypes).length > 0)
      entry.placeholderTypes = placeholderTypes;
    savedQueries.push(entry);
    await writeList('savedQueries', savedQueries);
  });
}

export async function unsaveQuery(collection: any, pipeline: any) {
  return serialize(async () => {
    const savedQueries = await readList('savedQueries');
    const key = dedupKey(collection, pipeline);
    await writeList(
      'savedQueries',
      savedQueries.filter((q) => dedupKey(q.collection, q.pipeline) !== key),
    );
  });
}

export async function isSaved(collection: any, pipeline: any) {
  const savedQueries = await readList('savedQueries');
  const key = dedupKey(collection, pipeline);
  return savedQueries.some((q) => dedupKey(q.collection, q.pipeline) === key);
}

function QueryRow({
  item,
  currentCollection,
  savedName,
  onLoad,
  onDismiss,
  showUnsave,
  onUnsave,
}: {
  item: any;
  currentCollection?: string | null;
  savedName?: string | null;
  onLoad: (pipeline: any, collection: any, variables?: any, placeholderTypes?: any) => void;
  onDismiss: () => void;
  showUnsave?: boolean;
  onUnsave?: (item: any) => void;
}) {
  return (
    <div
      class={
        styles.queryHistoryItem +
        (item.collection === currentCollection ? ` ${styles.queryHistoryItemCurrent}` : '')
      }
    >
      <div
        class={styles.queryHistoryItemInfo}
        onClick={() => {
          onLoad(item.pipeline, item.collection, item.variables, item.placeholderTypes);
          onDismiss();
        }}
      >
        <span class={styles.queryHistoryCollection}>{item.collection}</span>
        {savedName && <span class={styles.queryHistoryName}>{savedName}</span>}
        <span class={styles.queryHistoryTime}>{formatTime(item.ts)}</span>
        <div class={styles.queryHistoryPreview}>
          {item.pipeline && item.pipeline.length > 150
            ? item.pipeline.slice(0, 150) + '...'
            : item.pipeline}
        </div>
        {item.variables && Object.keys(item.variables).length > 0 && (
          <div class={styles.queryHistoryVariables}>
            {Object.entries(item.variables)
              .filter(([, v]) => v !== '')
              .map(([k, v]) => `{${k}}=${v}`)
              .join(', ')}
          </div>
        )}
      </div>
      {showUnsave && (
        <button
          class={styles.queryHistoryUnsaveBtn}
          title="Remove from saved"
          onClick={(e) => {
            e.stopPropagation();
            onUnsave!(item);
          }}
        >
          {'\u2605'}
        </button>
      )}
    </div>
  );
}

type ListProps = {
  onLoad: (pipeline: any, collection: any, variables?: any, placeholderTypes?: any) => void;
  onDismiss: () => void;
};

function HistoryList({ onLoad, onDismiss }: ListProps) {
  const [items, setItems] = useState<any[]>([]);
  const currentCollection = selectedCollection.value;

  useEffect(() => {
    readList('queryHistory').then(setItems);
  }, []);

  if (items.length === 0) {
    return (
      <div class={styles.queryHistoryList}>
        <div class={styles.queryHistoryEmpty}>No query history yet</div>
      </div>
    );
  }

  return (
    <div class={styles.queryHistoryList}>
      {items.map((item) => (
        <QueryRow
          item={item}
          currentCollection={currentCollection}
          onLoad={onLoad}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function SavedList({ onLoad, onDismiss }: ListProps) {
  const [items, setItems] = useState<any[]>([]);
  const currentCollection = selectedCollection.value;

  async function refresh() {
    setItems(await readList('savedQueries'));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleUnsave(item: any) {
    await unsaveQuery(item.collection, item.pipeline);
    refresh();
  }

  if (items.length === 0) {
    return (
      <div class={styles.queryHistoryList}>
        <div class={styles.queryHistoryEmpty}>No saved queries</div>
      </div>
    );
  }

  return (
    <div class={styles.queryHistoryList}>
      {items.map((item) => (
        <QueryRow
          item={item}
          currentCollection={currentCollection}
          savedName={item.name}
          onLoad={onLoad}
          onDismiss={onDismiss}
          showUnsave
          onUnsave={handleUnsave}
        />
      ))}
    </div>
  );
}

export function LibraryPanel({
  tab,
  onTabChange,
  onLoad,
  onDismiss,
}: { tab?: string; onTabChange: (t: string) => void } & ListProps) {
  return (
    <div class={styles.queryHistoryPanel}>
      <div class={styles.libraryTabs}>
        <button
          class={styles.libraryTab + (tab === 'saved' ? ` ${styles.libraryTabActive}` : '')}
          onClick={() => onTabChange('saved')}
        >
          Saved
        </button>
        <button
          class={styles.libraryTab + (tab === 'recent' ? ` ${styles.libraryTabActive}` : '')}
          onClick={() => onTabChange('recent')}
        >
          Recent
        </button>
      </div>
      {tab === 'saved' ? (
        <SavedList onLoad={onLoad} onDismiss={onDismiss} />
      ) : (
        <HistoryList onLoad={onLoad} onDismiss={onDismiss} />
      )}
    </div>
  );
}
