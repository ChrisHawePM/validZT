// Registers the service worker that makes the app work offline.
// This file exists separately (not inline in the HTML) because the app's
// security policy blocks inline scripts — a deliberate choice to prevent
// any injected code from running even if the hosting server is compromised.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
