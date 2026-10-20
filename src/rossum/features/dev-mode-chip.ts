// Hides Rossum's "Developer mode" chip in the navbar. It only repeats what the extension's
// own Dev features switch already shows, and on a small screen it costs the header room
// the organization's name needs. Rossum renders the label in English in every UI
// language. The chip is hidden with `display: none`, never moved, since React owns it, and
// only in the navbar's badge row, the parent of the nav tabs.

const LABEL = 'Developer mode';

function hideIfDevModeChip(node: Element) {
  if (!node.matches('.MuiChip-root')) return;
  if (!node.parentElement?.querySelector(':scope > .MuiTabs-root')) return;
  if (node.querySelector('.MuiChip-label')?.textContent?.trim() !== LABEL) return;
  (node as HTMLElement).style.display = 'none';
}

export function init() {
  for (const chip of document.querySelectorAll('.MuiChip-root')) hideIfDevModeChip(chip);
}

export function handleNode(node: HTMLElement) {
  hideIfDevModeChip(node);
}
