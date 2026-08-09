import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { initOnklave } from './onklave';
import './styles.css';

// Fire-and-forget: error tracking starts when the platform serves a config,
// and silently stays off everywhere else (see src/onklave.ts).
void initOnklave();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
