import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline: cache the whole app on the phone (works when the site is blocked, e.g. without VPN in China).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    // Ask the browser not to evict the cached app and saved statuses.
    navigator.storage?.persist?.().catch(() => undefined);
  });
}
