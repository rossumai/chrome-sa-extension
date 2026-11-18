// Lazy entry point, like initGalaxy/initInspector/initFabry. Auth reuses the
// Console's consoleAuth_<uuid> → sessionStorage credentials; no new auth path.
import * as store from './store.js';
import { PROGRESS_KEY } from '../training/storage.js';
import { activeApp } from '../console/store.js';

let listenersOn = false;

export async function initAcademy() {
  const domain = sessionStorage.getItem('consoleDomain') || '';
  if (!domain) {
    // Fail closed: a '' origin would read and write an un-scoped progress entry.
    store.connected.value = false;
    store.error.value =
      "Open the Rossum Console from this extension's popup on a Rossum tab to access the Academy.";
    return;
  }
  store.setOrigin(domain);
  try {
    await store.refreshProgress();
    store.connected.value = true;
  } catch (e: any) {
    store.error.value = String(e?.message || e);
    store.connected.value = false;
    return;
  }
  // Re-check when the trainee comes back from Rossum.
  store.checkNow();
  if (!listenersOn) {
    listenersOn = true;
    // Another Console tab may write this org's progress too — mirror it live.
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes[PROGRESS_KEY]) store.refreshProgress();
    });
    // Only while the Academy is the open app: another app's tab focus is not a reason to read.
    window.addEventListener('focus', () => {
      if (activeApp.value !== 'academy') return;
      store.rateLimited.value = false;
      store.checkNow();
    });
  }
}
