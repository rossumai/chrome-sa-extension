import { h } from 'preact';
import { NODE_STYLE, type NodeType } from '../graph.js';
import { visibleTypes, toggleType } from '../store.js';
import styles from './Legend.module.css';

const LABELS = {
  organization: 'Organization',
  workspace: 'Workspace',
  queue: 'Queue',
  hook: 'Hook',
  engine: 'Engine',
};

export default function Legend() {
  const vis = visibleTypes.value;
  return (
    <div class={styles.legend}>
      <div class={styles.title}>Legend</div>
      {(Object.keys(LABELS) as NodeType[]).map((type) => {
        const hidden = vis[type] === false;
        return (
          <button
            type="button"
            class={styles.item + (hidden ? ' ' + styles.hidden : '')}
            aria-pressed={hidden ? 'false' : 'true'}
            title={hidden ? `Show ${LABELS[type]}` : `Hide ${LABELS[type]}`}
            onClick={() => toggleType(type)}
          >
            <i class={styles.dot} style={`background:${NODE_STYLE[type].color}`}></i>
            {LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}
