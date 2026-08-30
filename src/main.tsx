import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { applyStoredTheme } from './shared/theme';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Getting this far means whatever the recovery in index.html was for is over.
// Clearing it here is what lets a later failure try again rather than give up.
try {
  sessionStorage.removeItem('games.reload.v1');
} catch {
  // No storage; the recovery guards itself on the same call and does nothing.
}

// index.html has already done this ahead of the first paint. Doing it again
// here is what keeps the module the authority on how it is read.
applyStoredTheme();

createRoot(root).render(
  <StrictMode>
    {/* Hash routing so a static build works from any host or subpath. */}
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  </StrictMode>,
);
