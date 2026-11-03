import { h } from 'preact';
import s from './Help.module.css';

export default function HelpButton({
  open,
  onToggle,
  class: className,
}: {
  open: boolean;
  onToggle: () => void;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={`${s.helpBtn} ${open ? s.helpBtnOn : ''} ${className || ''}`}
      onClick={onToggle}
    >
      <span class={s.helpQ}>?</span> Help
    </button>
  );
}
