import { h, type ComponentChildren, type HTMLAttributes } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { matchSections, type Searchable } from './geometry.js';
import { animateScrollTop } from '../mdh/smoothScroll.js';
import s from './Help.module.css';

export type HelpSection = Searchable & { chip: string; body: ComponentChildren };

// The help's content: header, search, chips and sections. The frame around it is HelpWindow's.
export default function HelpPanel({
  title,
  placeholder,
  sections,
  onClose,
  titleBarProps,
}: {
  title: string;
  placeholder: string;
  sections: HelpSection[];
  onClose: () => void;
  // spread onto the header, so a frame can make it a title bar (onMouseDown, a cursor class)
  titleBarProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  const matched = matchSections(sections, query);
  const { class: barClass, ...barRest } = titleBarProps ?? {};

  const handleChipClick = (sectionId: string) => {
    const section = sectionRefs.current.get(sectionId);
    const body = bodyRef.current;
    if (section && body) {
      animateScrollTop(body, section.offsetTop - body.offsetTop);
    }
  };

  return (
    <div class={s.panel}>
      <div {...barRest} class={`${s.panelHead} ${barClass ?? ''}`} data-help-titlebar>
        <b>{title}</b>
        <button class={s.closeBtn} onClick={onClose} aria-label="Close help">
          ✕
        </button>
      </div>
      <div class={s.search}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          class="input"
          placeholder={placeholder}
          value={query}
          onInput={(e: any) => setQuery(e.target.value)}
        />
      </div>
      <nav class={s.chips}>
        {matched.map((sec) => (
          <button key={sec.id} class={s.chip} onClick={() => handleChipClick(sec.id)}>
            {sec.chip}
          </button>
        ))}
      </nav>
      <div class={s.panelBody} ref={bodyRef}>
        {matched.length > 0 ? (
          matched.map((sec) => (
            <section
              key={sec.id}
              class={s.sec}
              ref={(el) => {
                if (el) sectionRefs.current.set(sec.id, el);
              }}
            >
              <h3>{sec.title}</h3>
              {sec.body}
            </section>
          ))
        ) : (
          <p class={s.empty}>No help matches “{query}”.</p>
        )}
      </div>
    </div>
  );
}
