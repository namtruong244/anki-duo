import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <h1>Anki Duo</h1>
  </StrictMode>,
);
