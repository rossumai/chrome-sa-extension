import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { loading } from '../store.js';
import styles from './LoadingOverlay.module.css';

const SHOW_DELAY = 300;

export default function LoadingOverlay() {
  const isLoading = loading.value;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setVisible(true), SHOW_DELAY);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [isLoading]);

  return (
    <div class={styles.loadingOverlay + (visible ? ` ${styles.loadingOverlayVisible}` : '')}>
      <div class={styles.spinner}></div>
    </div>
  );
}
