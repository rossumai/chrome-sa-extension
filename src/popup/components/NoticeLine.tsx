// The line under the popup's header that the unlock / hide notice (5 clicks on the version
// hash) takes over for 2.5 s: the note on an unrelated tab, the app list's label on the
// Console. It covers nothing and never joins the footer row, which it used to wrap.
import { h, Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import type { UnlockNotice } from '../offSite.js';

export default function NoticeLine({
  notice,
  children,
}: {
  notice: UnlockNotice | null;
  children: ComponentChildren;
}) {
  if (!notice) return <Fragment>{children}</Fragment>;
  return <UnlockNoticeText notice={notice} class="notice-line" />;
}

export function UnlockNoticeText({ notice, class: cls }: { notice: UnlockNotice; class?: string }) {
  const detail = notice.unlocked
    ? 'Academy, rdc added'
    : notice.fellBack
      ? 'switched to Data'
      : null;
  return (
    <p class={`unlock-notice${cls ? ` ${cls}` : ''}`} role="status">
      {notice.unlocked ? <span class="console-app-badge is-exp">exp</span> : null}
      <span class="unlock-notice-main">
        {notice.unlocked ? 'Experimental features unlocked' : 'Experimental features hidden'}
      </span>
      {detail ? <span class="unlock-notice-detail">{detail}</span> : null}
    </p>
  );
}
