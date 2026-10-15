// Installing Ping Me on the home screen.
//  • Android / desktop Chrome, Edge, Samsung: one tap → the browser's own install prompt.
//  • iPhone / iPad: Apple offers no install API, so we show a short visual guide.
//  • In-app browsers (WhatsApp, Instagram, Facebook…) can't install anything → guide to open in Safari/Chrome.
import { h, icon, toast, isIOS, isAndroid, isStandalone, store, registerLayer } from './ui.js';

const ua = navigator.userAgent;
export const isInAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(ua);
const iosBrowser = () => (/CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : 'Safari');
const isIPad = () => /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const installed = () => isStandalone() || store.get('installed', false);
export const canPromptInstall = () => !!window.__bip;

// The install prompt event is captured as early as possible by an inline script in index.html.
function waitForPrompt(ms) {
  if (window.__bip) return Promise.resolve(window.__bip);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    addEventListener('pm:installable', () => { clearTimeout(t); res(window.__bip); }, { once: true });
  });
}

// Returns 'installed' | 'dismissed' | 'guide'
export async function installApp() {
  if (isStandalone()) return 'installed';
  if (isInAppBrowser()) { showGuide(); return 'guide'; }
  const e = isIOS() ? null : await waitForPrompt(1500);
  if (e) {
    try {
      e.prompt();
      const { outcome } = await e.userChoice;
      window.__bip = null;
      if (outcome === 'accepted') {
        store.set('installed', true);
        toast('Ping Me is on your home screen — open it from there');
        return 'installed';
      }
      return 'dismissed';
    } catch { /* fall through to the guide */ }
  }
  showGuide();
  return 'guide';
}

const step = (n, ...content) => h('div', { class: 'ig-step' }, h('span', { class: 'n' }, String(n)), h('span', null, ...content));

export function showGuide() {
  document.querySelector('.ig')?.remove();
  let title, steps, arrow = null;
  if (isInAppBrowser()) {
    title = isIOS() ? 'Open in Safari first' : 'Open in Chrome first';
    steps = [
      step(1, 'Tap ', h('b', null, '⋯'), ' or the ', icon('share'), ' button in this screen’s corner'),
      step(2, 'Choose ', h('b', null, isIOS() ? 'Open in Safari' : 'Open in Chrome'), ' (or “Open in browser”)'),
      step(3, 'Then tap ', h('b', null, 'Get the app'), ' again'),
    ];
    arrow = 'top';
  } else if (isIOS()) {
    const b = iosBrowser();
    title = 'Add Ping Me to your Home Screen';
    steps = [
      step(1, 'Tap ', icon('iosshare'), ' ', h('b', null, 'Share'), b === 'Safari' ? (isIPad() ? ' (top right)' : ' at the bottom of the screen') : ' (in the address bar)',
        b === 'Safari' ? h('small', null, 'On the newest iPhones it’s inside the ', h('b', null, '⋯'), ' button.') : null),
      step(2, 'Scroll down and tap ', icon('addsq'), ' ', h('b', null, 'Add to Home Screen')),
      step(3, 'Tap ', h('b', null, 'Add'), ' — then open ', h('b', null, 'Ping Me'), ' from your Home Screen'),
    ];
    arrow = b === 'Safari' && !isIPad() ? 'bottom' : 'top';
  } else if (isAndroid()) {
    title = 'Install Ping Me';
    steps = [
      step(1, 'Tap ', icon('dotsv'), ' (top right of your browser)'),
      step(2, 'Tap ', h('b', null, 'Install app'), ' or ', h('b', null, 'Add to Home screen')),
      step(3, 'If asked, choose ', h('b', null, 'Install'), ' — not “Create shortcut”'),
    ];
    arrow = 'top';
  } else {
    title = 'Install Ping Me';
    steps = [
      step(1, 'Click the ', icon('download'), ' install icon at the right end of the address bar'),
      step(2, 'Or open the browser menu → ', h('b', null, 'Install Ping Me'), ' / ', h('b', null, 'Apps → Install this site')),
    ];
  }
  const close = () => { unregister(); root.remove(); };
  const unregister = registerLayer(close);
  const root = h('div', { class: 'ig', onclick: (e) => { if (e.target === root) close(); } },
    arrow ? h('div', { class: 'ig-arrow ' + arrow }, icon(arrow === 'bottom' ? 'down' : 'send')) : null,
    h('div', { class: 'ig-card' },
      h('img', { class: 'ig-icon', src: '/icons/icon-192.png', alt: '' }),
      h('h2', null, title),
      h('div', { class: 'ig-steps' }, steps),
      h('button', { class: 'btn', onclick: close }, 'Got it')));
  document.body.append(root);
}
