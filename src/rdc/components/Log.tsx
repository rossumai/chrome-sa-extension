// rdc's log lines, with their ANSI colour rendered as spans: text nodes only, never HTML.
import { h } from 'preact';
import { parseAnsi, type AnsiStyle } from '../ansi.js';
import styles from './Deploy.module.css';

// One SGR style as inline CSS. Dim is opacity, not a grey, so it stays readable in both themes.
function css(st: AnsiStyle): Record<string, string> {
  const o: Record<string, string> = {};
  if (st.color) o.color = st.color;
  if (st.bold) o.fontWeight = '600';
  if (st.dim) o.opacity = '0.6';
  if (st.italic) o.fontStyle = 'italic';
  if (st.underline) o.textDecoration = 'underline';
  return o;
}

// A log line from rdc, its colour rendered as spans: text nodes only, never HTML.
export function LogLine({ line }: { line: string }) {
  return (
    <div class={styles.logLine}>
      {parseAnsi(line).map((seg) => (
        <span style={css(seg.style)}>{seg.text}</span>
      ))}
    </div>
  );
}
