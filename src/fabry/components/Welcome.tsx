import { h } from 'preact';
import Composer from './Composer.jsx';
import FabryMark from '../../ui/FabryMark.jsx';
import { STARTERS } from '../starters.js';
import { sendMessage } from '../chat.js';
import styles from './Welcome.module.css';

// Centered "welcome" empty state for a new chat (Claude-style): the composer is the
// hero, vertically centered under a short greeting, with the starter prompts as
// pills below it. App renders this instead of the thread stack while the chat is
// empty; the moment a first message starts, the layout switches to the normal
// bottom-composer thread view.
export default function Welcome() {
  return (
    <div class={styles.welcome}>
      <div class={styles.welcomeInner}>
        <div class={styles.welcomeMark}>
          <FabryMark size={40} />
        </div>
        <div class={styles.welcomeTitle}>What would you like to explore?</div>
        <Composer welcome />
        <div class={styles.welcomePills}>
          {STARTERS.map((s) => (
            <button
              type="button"
              key={s.label}
              class={styles.welcomePill}
              title={s.prompt}
              onClick={() => sendMessage(s.prompt)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
