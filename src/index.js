import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

/**
 * FocusFlow: Entry Point
 * Initializing the React root and rendering the primary application component
 * inside StrictMode for enhanced development-time checks.
 */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/**
 * Progressive Web App (PWA) Implementation
 * Service Worker registration to enable offline availability and caching strategies.
 * This ensures the FocusFlow dashboard remains accessible during low-connectivity scenarios.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/sw.js`;
    navigator.serviceWorker.register(swUrl)
      .then(reg => {
        // Log successful registration for system auditing
        console.log('FocusFlow PWA: Deployment Status [Online/Cached]');
      })
      .catch(err => {
        // Error handling for service worker failures
        console.error('FocusFlow PWA: Deployment Sync Error:', err);
      });
  });
}

/**
 * Telemetry & Performance
 * Captures core web vitals and interaction metrics to optimize the UX.
 */
reportWebVitals();