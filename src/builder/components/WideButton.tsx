import { h } from 'preact';
import { panelWide, setPanelWide } from './panels.js';
import Icon from './icons.jsx';
import s from './Builder.module.css';

// In every right panel's header, before ✕: switches the panel between 400px and wide.
export default function WideButton() {
  const wide = panelWide.value;
  return (
    <button
      type="button"
      class={s.iconBtn + ' ' + s.wideBtn}
      data-action="panel-wide"
      aria-pressed={wide ? 'true' : 'false'}
      title={wide ? 'Narrow panel' : 'Wide panel'}
      onClick={() => setPanelWide(!wide)}
    >
      <Icon name={wide ? 'minimize' : 'maximize'} size={14} />
    </button>
  );
}
