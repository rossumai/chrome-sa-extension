import { h } from 'preact';
import { useState, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { loading, error } from '../store.js';
import { openModal, closeModal, ModalBody, ModalFieldLabel } from './Modal.jsx';
import JsonEditor from './JsonEditor.jsx';
import BulkConfirm from './BulkConfirm.jsx';
import * as api from '../api.js';
import { previewMatch, runBulkDelete, selectionToFilter, UNDO_LIMIT } from '../bulkOps.js';
import type { JsonEditorHandle } from './JsonEditor.jsx';
import ctl from '../../ui/controls.module.css';
import bulkCss from './bulk.module.css';

const PREVIEW_DEBOUNCE_MS = 400;

type BulkOpen = {
  collection: string;
  mode: string;
  /** A Data Storage _id is a string or an EJSON `{ $oid }` wrapper. */
  ids?: Array<string | { $oid: string }>;
  filter?: any;
  onSuccess?: () => unknown;
  fieldsFn?: () => any;
};

export function openBulkDelete({ collection, mode, ids, filter, onSuccess, fieldsFn }: BulkOpen) {
  openModal(
    mode === 'selection'
      ? `Delete ${ids!.length} record${ids!.length !== 1 ? 's' : ''}`
      : 'Delete by filter',
    () => (
      <Body
        collection={collection}
        mode={mode}
        ids={ids}
        initialFilter={filter}
        onSuccess={onSuccess}
        fieldsFn={fieldsFn}
      />
    ),
  );
}

function Body({
  collection,
  mode,
  ids,
  initialFilter,
  onSuccess,
  fieldsFn,
}: Omit<BulkOpen, 'filter'> & { initialFilter?: any }) {
  const rootRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<JsonEditorHandle | null>(null);
  const [filterJson, setFilterJson] = useState(() => JSON.stringify(initialFilter || {}, null, 2));
  const [filterValue, setFilterValue] = useState(initialFilter || {});
  const [filterValid, setFilterValid] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [sample, setSample] = useState<any[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const isSelection = mode === 'selection';

  // The actual MongoDB filter we'll execute. In selection mode it's locked to
  // {_id:{$in:[...ids]}}; in filter mode it tracks the editor.
  const effectiveFilter = isSelection ? selectionToFilter(ids!) : filterValue;

  // Force name-gate when the filter is the literal "all-records" object — the
  // user must spell out the collection. We deliberately don't try to be clever
  // about $expr:true, $or:[{...}] etc.; only literal {} triggers this.
  const isEmptyFilter = !isSelection && filterValid && Object.keys(filterValue).length === 0;

  function runPreview(filt: any) {
    setPreviewing(true);
    setPreviewError(null);
    const ac = new AbortController();
    if (isSelection) {
      api
        .aggregate(collection, [{ $match: filt }, { $limit: 5 }], { signal: ac.signal })
        .then((res) => {
          setSample(res.result || []);
          setCount(ids!.length);
          setPreviewing(false);
        })
        .catch((err) => {
          setPreviewError(err.message);
          setPreviewing(false);
        });
    } else {
      previewMatch(collection, filt, { signal: ac.signal })
        .then(({ count: c, sample: s }) => {
          setCount(c);
          setSample(s);
          setPreviewing(false);
        })
        .catch((err) => {
          setPreviewError(err.message);
          setPreviewing(false);
        });
    }
    return () => ac.abort();
  }

  useLayoutEffect(() => {
    // Guard against running in an orphaned Preact tree (can happen when a new
    // Modal root is created without properly unmounting the old one, e.g. in
    // tests that clear document.body.innerHTML without calling render(null)).
    if (rootRef.current && !rootRef.current.isConnected) return;
    const cancel = runPreview(effectiveFilter);
    return cancel;
  }, []);

  // Debounced re-preview when the user edits the filter (filter mode only).
  useEffect(() => {
    if (isSelection) return;
    if (!filterValid) return;
    const t = setTimeout(() => runPreview(filterValue), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filterJson, filterValid, isSelection]);

  function handleEditorValidChange() {
    if (!editorRef.current) return;
    if (editorRef.current.isValid()) {
      setFilterValue(editorRef.current.getParsed());
      setFilterValid(true);
      setFilterJson(editorRef.current.getValue());
    } else {
      setFilterValid(false);
    }
  }

  async function handleSubmit() {
    if (!Number.isFinite(count) || (count as number) <= 0) return;
    setRunning(true);
    try {
      loading.value = true;
      error.value = null;
      await runBulkDelete(collection, effectiveFilter, {
        count: count as number,
        undoMessage: `Deleted ${count} record${count !== 1 ? 's' : ''} from "${collection}"`,
        onSuccess,
      });
      loading.value = false;
      setResultMsg(`Deleted ${count} record${count !== 1 ? 's' : ''}`);
      setTimeout(() => closeModal(), 800);
    } catch (err: any) {
      loading.value = false;
      setRunning(false);
      setPreviewError(err.message);
    }
  }

  const undoNote =
    (count as number) > UNDO_LIMIT
      ? `Undo is unavailable above ${UNDO_LIMIT.toLocaleString()} records.`
      : 'You’ll have a few seconds to undo.';

  return (
    <ModalBody rootRef={rootRef}>
      <ModalFieldLabel>Filter:</ModalFieldLabel>
      {isSelection ? (
        <pre class={bulkCss.bulkFilterReadonlyPre}>{JSON.stringify(effectiveFilter, null, 2)}</pre>
      ) : (
        <JsonEditor
          value={filterJson}
          minHeight="100px"
          mode="query"
          fields={fieldsFn}
          editorRef={editorRef}
          onValidChange={handleEditorValidChange}
        />
      )}

      <div class={bulkCss.bulkPreview}>
        {previewing && <div class={bulkCss.bulkPreviewLoading}>{'Previewing…'}</div>}
        {previewError && <div class={bulkCss.bulkPreviewError}>{previewError}</div>}
        {!previewing && !previewError && (
          <div data-testid="bulk-preview-count" class={bulkCss.bulkPreviewCount}>
            {count} record{count !== 1 ? 's' : ''} match
          </div>
        )}
        {sample.length > 0 && sample.length < (count as number) && (
          <div class={bulkCss.bulkPreviewSampleNote}>
            Preview shows a sample of the first {sample.length}{' '}
            {sample.length === 1 ? 'record' : 'records'} below — the operation will apply to all{' '}
            {count!.toLocaleString()}.
          </div>
        )}
        {sample.length > 0 && (
          <div class={bulkCss.sampleCards}>
            {sample.map((doc, i) => (
              <div class={`${bulkCss.sampleCard} ${bulkCss.sampleCardDanger}`}>
                <div class={bulkCss.sampleCardHeader}>
                  Document {i + 1}
                  <span class={bulkCss.sampleCardHeaderMeta}>Will be deleted</span>
                </div>
                <pre class={bulkCss.sampleCardBody}>{JSON.stringify(doc, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
        <div class={bulkCss.bulkUndoNote}>{undoNote}</div>
      </div>

      {resultMsg && <div class={bulkCss.bulkResult}>{resultMsg}</div>}

      <BulkConfirm
        count={count as number}
        collection={collection}
        forceNameGate={isEmptyFilter}
        disabled={running || !!resultMsg || count === 0}
        submitLabel={running ? 'Deleting…' : 'Delete'}
        submitClass={ctl.btnDanger}
        onSubmit={handleSubmit}
        onCancel={closeModal}
      />
    </ModalBody>
  );
}
