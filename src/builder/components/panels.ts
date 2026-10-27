// Fixed layout for a 13" screen: the right panel has one width (.inspector); the queue list is
// a drawer while a schema is open; the grid turns compact while a right panel is open.
import { signal, computed } from '@preact/signals';
import {
  schemaFabry,
  validationPanel,
  ruleEditor,
  hookEditor,
  selectedKey,
  codeView,
  enginePanel,
} from '../store.js';

export const navDrawer = signal(false);

export const panelOpen = computed(
  () =>
    schemaFabry.value.open ||
    !!validationPanel.value ||
    !!ruleEditor.value ||
    !!hookEditor.value ||
    !!codeView.value ||
    enginePanel.value ||
    selectedKey.value != null,
);

// Wide: the right panel takes all but a narrow grid (for long code). One choice for every
// panel, remembered per browser.
const WIDE_KEY = 'builderPanelWide';
export const panelWide = signal(false);
let wideLoaded = false;

export function loadPanelWide() {
  if (wideLoaded) return;
  wideLoaded = true;
  globalThis.chrome?.storage?.local
    ?.get([WIDE_KEY])
    .then((v) => {
      panelWide.value = v?.[WIDE_KEY] === true;
    })
    .catch(() => {});
}

export function setPanelWide(v: boolean) {
  panelWide.value = v;
  globalThis.chrome?.storage?.local?.set({ [WIDE_KEY]: v })?.catch(() => {});
}
