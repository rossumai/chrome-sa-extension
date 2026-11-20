// The line under the popup's header that the unlock / hide notice (5 clicks on the version
// hash) takes over for 2.5 s: the note on an unrelated tab, the app list's label on the
// Console. It covers nothing and never joins the footer row, which it used to wrap.
import { h, Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import type { UnlockNotice } from '../offSite.js';
import off from './OffSite.module.css';

export default function NoticeLine({
  notice,
  children,
}: {
  notice: UnlockNotice | null;
  children: ComponentChildren;
}) {
  if (!notice) return <Fragment>{children}</Fragment>;
  return <UnlockNoticeText notice={notice} class={off.noticeLine} />;
}

export function UnlockNoticeText({ notice, class: cls }: { notice: UnlockNotice; class?: string }) {
  const detail = notice.unlocked
    ? 'Academy, rdc added'
    : notice.fellBack
      ? 'switched to Data'
      : null;
  return (
    <p class={`${off.unlockNotice}${cls ? ` ${cls}` : ''}`} role="status">
      {notice.unlocked ? <span class={`${off.consoleAppBadge} ${off.isExp}`}>exp</span> : null}
      <span class="unlock-notice-main">
        {notice.unlocked ? 'Experimental features unlocked' : 'Experimental features hidden'}
      </span>
      {detail ? <span class={off.unlockNoticeDetail}>{detail}</span> : null}
    </p>
  );
}
