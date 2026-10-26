// Fixed layout for a 13" screen: the right panel has one width (.inspector); the queue list is
// a drawer while a schema is open; the grid turns compact while a right panel is open.
import { signal, computed } from '@preact/signals';
import { schemaFabry, validationPanel, ruleEditor, hookEditor, selectedKey } from '../store.js';

export const navDrawer = signal(false);

export const panelOpen = computed(
  () =>
    schemaFabry.value.open ||
    !!validationPanel.value ||
    !!ruleEditor.value ||
    !!hookEditor.value ||
    selectedKey.value != null,
);
