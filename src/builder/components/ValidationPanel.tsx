import { h } from 'preact';
import { validation, rightPanel, type RightPanel, annotationId } from '../store.js';
import { closeValidationPanel } from '../index.jsx';
import PanelHead from './PanelHead.jsx';
import ValidationRules from './ValidationRules.jsx';
import ProvenanceReplay from './ProvenanceReplay.jsx';
import s from './Builder.module.css';

export default function ValidationPanel() {
  const { tab } = rightPanel.value as Extract<RightPanel, { kind: 'validation' }>;
  return (
    <aside class={s.inspector} data-panel="validation">
      <PanelHead
        title={`Validation · annotation (${annotationId.value})`}
        onClose={closeValidationPanel}
      />
      <div class={'tab-bar ' + s.tabs}>
        {(['rules', 'provenance'] as const).map((t) => (
          <button
            type="button"
            data-tab={t}
            class={'tab' + (tab === t ? ' active' : '')}
            onClick={() => (rightPanel.value = { kind: 'validation', tab: t })}
          >
            {t === 'rules' ? 'Rules' : 'Provenance'}
          </button>
        ))}
      </div>
      {tab === 'rules' ? (
        validation.value ? (
          <ValidationRules />
        ) : (
          <div class={s.dim}>Revalidate the annotation to see results.</div>
        )
      ) : (
        <ProvenanceReplay />
      )}
    </aside>
  );
}
