// src/console/components/Console.tsx
import { h, Fragment } from 'preact';
import { activeApp } from '../store.js';
import Rail from './Rail.jsx';
import MdhApp from '../../mdh/components/App.jsx';
import AuditApp from '../../audit/components/App.jsx';
import GalaxyApp from '../../galaxy/components/App.jsx';
import InspectorApp from '../../inspector/components/App.jsx';
import FabryApp from '../../fabry/components/App.jsx';
import AcademyApp from '../../academy/components/App.jsx';
import BuilderApp from '../../builder/components/App.jsx';
import CibApp from '../../cib/components/App.jsx';
import RdcApp from '../../rdc/components/App.jsx';
import * as mdhStore from '../../mdh/store.js';
import * as auditStore from '../../audit/store.js';
import * as galaxyStore from '../../galaxy/store.js';
import * as inspectorStore from '../../inspector/store.js';
import * as fabryStore from '../../fabry/store.js';
import * as academyStore from '../../academy/store.js';
import * as builderStore from '../../builder/store.js';
import * as cibStore from '../../cib/store.js';
import * as rdcStore from '../../rdc/store.js';

function Connecting() {
  return (
    <div class="app-root">
      <div class="empty-state">Connecting{'…'}</div>
    </div>
  );
}

// The CIB page holds its form, log and a running deploy in component state, so once opened it stays
// mounted and is only hidden while another app is active; unmounting it would lose a deploy in flight.
let cibOpened = false;

export default function Console() {
  const app = activeApp.value;
  const cibC = cibStore.connected.value;
  if (app === 'cib') cibOpened = true;

  let view;
  if (app === 'mdh') {
    const c = mdhStore.connected.value;
    view = c === null ? <Connecting /> : <MdhApp connected={c} />;
  } else if (app === 'galaxy') {
    const c = galaxyStore.connected.value;
    view = c === null ? <Connecting /> : <GalaxyApp connected={c} />;
  } else if (app === 'inspector') {
    const c = inspectorStore.connected.value;
    view = c === null ? <Connecting /> : <InspectorApp connected={c} />;
  } else if (app === 'fabry') {
    const c = fabryStore.connected.value;
    view = c === null ? <Connecting /> : <FabryApp connected={c} />;
  } else if (app === 'builder') {
    const c = builderStore.connected.value;
    view = c === null ? <Connecting /> : <BuilderApp connected={c} />;
  } else if (app === 'cib') {
    view = cibC === null ? <Connecting /> : null;
  } else if (app === 'rdc') {
    const c = rdcStore.connected.value;
    view = c === null ? <Connecting /> : <RdcApp connected={c} />;
  } else if (app === 'academy') {
    const c = academyStore.connected.value;
    view = c === null ? <Connecting /> : <AcademyApp connected={c} />;
  } else {
    const c = auditStore.connected.value;
    view = c === null ? <Connecting /> : <AuditApp connected={c} />;
  }

  return (
    <Fragment>
      <Rail />
      {view}
      {cibOpened && cibC !== null && (
        <div key="cib" style={{ display: app === 'cib' ? 'contents' : 'none' }}>
          <CibApp connected={cibC} />
        </div>
      )}
    </Fragment>
  );
}
