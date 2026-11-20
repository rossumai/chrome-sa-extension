import { h } from 'preact';
import { useState } from 'preact/hooks';
import jt from '../../ui/JsonTree.module.css';
import styles from './JsonTree.module.css';

const COLLAPSE_THRESHOLD = 30;

export default function JsonTree({ data, depth = 0 }: { data: any; depth?: number }) {
  if (data == null) return <span class={`${styles.leaf} ${styles.null}`}>null</span>;
  if (typeof data !== 'object') return <Leaf value={data} />;
  if (Array.isArray(data)) return <ArrayNode arr={data} depth={depth} />;
  return <ObjectNode obj={data} depth={depth} />;
}

function ObjectNode({ obj, depth }: { obj: any; depth: number }) {
  const entries = Object.entries(obj);
  const [collapsed, setCollapsed] = useState(depth >= 1 && entries.length > COLLAPSE_THRESHOLD);
  if (entries.length === 0) {
    return <span class={styles.empty}>{'{}'}</span>;
  }
  return (
    <div class={jt.root}>
      <span class={styles.toggle} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? `▶ {${entries.length}}` : '▼'}
      </span>
      {!collapsed && (
        <div class={styles.nested}>
          {entries.map(([k, v]) => (
            <div class={styles.row}>
              <span class={styles.key}>{k}</span>
              <span class={styles.sep}>: </span>
              {typeof v === 'object' && v !== null ? (
                <JsonTree data={v} depth={depth + 1} />
              ) : (
                <Leaf value={v} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArrayNode({ arr, depth }: { arr: any[]; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth >= 1 && arr.length > COLLAPSE_THRESHOLD);
  if (arr.length === 0) return <span class={styles.empty}>{'[]'}</span>;
  return (
    <div class={jt.root}>
      <span class={styles.toggle} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? `▶ [${arr.length}]` : `▼ [${arr.length}]`}
      </span>
      {!collapsed && (
        <div class={styles.nested}>
          {arr.map((item, i) => (
            <div class={styles.row}>
              <span class={styles.index}>[{i}]</span>
              <span class={styles.sep}>: </span>
              {typeof item === 'object' && item !== null ? (
                <JsonTree data={item} depth={depth + 1} />
              ) : (
                <Leaf value={item} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ value }: { value: any }) {
  if (value === null) return <span class={`${styles.leaf} ${styles.null}`}>null</span>;
  if (typeof value === 'string') {
    return <span class={`${styles.leaf} ${styles.string}`}>{`"${value}"`}</span>;
  }
  if (typeof value === 'number')
    return <span class={`${styles.leaf} ${styles.number}`}>{String(value)}</span>;
  if (typeof value === 'boolean')
    return <span class={`${styles.leaf} ${styles.bool}`}>{String(value)}</span>;
  return <span class={styles.leaf}>{String(value)}</span>;
}
