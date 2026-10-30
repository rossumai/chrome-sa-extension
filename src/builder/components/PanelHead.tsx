import { h, type ComponentChildren } from 'preact';
import { panelWide, setPanelWide } from './panels.js';
import Icon from './icons.jsx';
import s from './Builder.module.css';

// Every right panel's header: its title, the switch between 400px and wide, and ✕.
export default function PanelHead({
  title,
  mono = false,
  closeAction,
  onClose,
}: {
  title: ComponentChildren;
  mono?: boolean;
  closeAction?: string;
  onClose: () => void;
}) {
  const wide = panelWide.value;
  return (
    <div class={s.ruleHead}>
      <h4 class={(mono ? s.mono + ' ' : '') + s.inspTitle}>{title}</h4>
      <button
        type="button"
        class={'icon-btn ' + s.wideBtn}
        data-action="panel-wide"
        aria-pressed={wide ? 'true' : 'false'}
        title={wide ? 'Narrow panel' : 'Wide panel'}
        onClick={() => setPanelWide(!wide)}
      >
        <Icon name={wide ? 'minimize' : 'maximize'} size={14} />
      </button>
      <button
        type="button"
        class="icon-btn"
        data-action={closeAction}
        title="Close (Esc)"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
