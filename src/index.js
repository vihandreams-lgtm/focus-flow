import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// This part registers the service worker to make the app work offline
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/sw.js`;
    navigator.serviceWorker.register(swUrl)
      .then(reg => {
        console.log('FocusFlow PWA: Service Worker Registered Successfully!');
      })
      .catch(err => {
        console.log('FocusFlow PWA: Service Worker Registration Failed:', err);
      });
  });
}

// Performance monitoring
reportWebVitals();