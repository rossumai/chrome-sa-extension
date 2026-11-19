import { h, render } from 'preact';
// First, so the reset and the #app shell open the bundle's emitted sheet.
import './page.module.css';
import App from './components/App.jsx';

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  render(<App tab={tab} />, document.getElementById('app')!);
})();
