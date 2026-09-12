import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/theme/tokens.css';
import './ui/theme/reset.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The wordmark index.html paints on the HTML parser hands over here, once there
// is something real behind it. Removing it on mount rather than on a timer is
// what keeps it honest on a fast connection and on a slow one alike.
document.getElementById('splash')?.remove();
