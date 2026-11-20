import { h } from 'preact';
import { availability, aiAvailable } from '../store.js';
import ConnectionBar from './ConnectionBar.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import FiltersBar from './FiltersBar.jsx';
import ResultsTable from './ResultsTable.jsx';
import DetailPanel from './DetailPanel.jsx';
import Pagination from './Pagination.jsx';
import UnavailablePanel from './UnavailablePanel.jsx';
import FabryPanel from './FabryPanel.jsx';
import es from '../../ui/EmptyState.module.css';
import shell from '../../ui/AppShell.module.css';
import styles from './App.module.css';

export default function App({ connected }: { connected: boolean | null }) {
  return (
    <div class={shell.root}>
      <main class={shell.main}>
        <ConnectionBar connected={connected} />
        <ErrorBanner />
        {!connected ? (
          <div class={es.root}>
            Not connected — open a Rossum page and click Audit Logs in the extension popup.
          </div>
        ) : availability.value === 'unavailable' ? (
          <UnavailablePanel />
        ) : (
          <div class={styles.body}>
            {aiAvailable.value && <FabryPanel />}
            <FiltersBar />
            <div class={styles.resultsRow}>
              <ResultsTable />
              <DetailPanel />
            </div>
            <Pagination />
          </div>
        )}
      </main>
    </div>
  );
}
