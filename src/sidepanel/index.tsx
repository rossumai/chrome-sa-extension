import { h, render } from 'preact';
// The popup's page base (reset, #app shell), first in the bundle's emitted sheet.
import '../popup/page.module.css';
import App from './components/App.jsx';

render(<App />, document.getElementById('app')!);
