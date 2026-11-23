import { h } from 'preact';
import { useDelayedLoading } from '../hooks/useDelayedLoading.js';
import styles from './LoadingOverlay.module.css';

// The global spinner for writers of store.loading (sidebar, index panels, bulk
// ops, record edits). The Data panel's query no longer uses it: its loading is
// shown in the results area (spec 2026-11-23-mdh-loading-states; step 2 retires
// this overlay altogether).
export default function LoadingOverlay() {
  const visible = useDelayedLoading();
  return (
    <div class={styles.loadingOverlay + (visible ? ` ${styles.loadingOverlayVisible}` : '')}>
      <div class={styles.spinner}></div>
    </div>
  );
}
