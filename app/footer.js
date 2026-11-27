// footer.js — the footer line of trip setup: language picker, Share, Credits, Install.
//
// initFooter({ onLang }) wires it once; onLang(code) is called when the picker changes the language (app.js
// applies it the same way as the Settings dropdown). renderFooter() refreshes the language code and the
// texts JS writes; app.js calls it after every language change.
// Share: a QR code (share-qr.svg, a static file made once with segno), Copy link and the system share sheet.
// Credits: CREDITS.md, rendered by a small Markdown subset renderer that builds DOM nodes (never innerHTML).
// Install: the browser's own prompt when it offered one, else the steps for that browser; hidden once installed.

import { t, getLang, LANGS } from './i18n.js';

export const SHARE_URL = 'https://github.com/mpascucci/verdrive';
const CREDITS_SOURCE_URL = 'https://github.com/mpascucci/verdrive/blob/main/app/CREDITS.md';

const $ = (id) => document.getElementById(id);

// Close a dialog with its Close button or a tap on the backdrop (Esc works by itself).
function closable(dialog, closeBtn) {
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

// ----- language picker: a globe and the code; a transparent native <select> on top opens the full names -----
function initLang(onLang) {
  const sel = $('foot-lang');
  for (const [code, name] of Object.entries(LANGS)) sel.append(new Option(name, code));
  sel.addEventListener('change', () => onLang(sel.value));
}

export function renderFooter() {
  $('foot-lang').value = getLang();
  $('foot-lang-code').textContent = getLang().toUpperCase();
  $('share-qr').alt = t('share.qrAlt', { url: SHARE_URL });
}

// ----- Share -----
function initShare() {
  const dialog = $('share-dialog');
  $('share-open').addEventListener('click', () => dialog.showModal());
  closable(dialog, $('share-close'));

  const copy = $('share-copy');
  copy.addEventListener('click', async () => {
    const label = copy.firstElementChild;
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      label.textContent = t('share.copied');
      copy.classList.add('done');
      setTimeout(() => { label.textContent = t('share.copy'); copy.classList.remove('done'); }, 1500);
    } catch {
      prompt(t('share.copyPrompt'), SHARE_URL);
    }
  });

  // system share sheet (phones, some desktop browsers); the button stays hidden without the API
  const native = $('share-native');
  if (navigator.share) {
    native.hidden = false;
    native.addEventListener('click', async () => {
      try { await navigator.share({ title: 'VerDrive', text: t('share.text'), url: SHARE_URL }); } catch { /* cancelled */ }
    });
  }
}

// ----- Credits: CREDITS.md in a dialog (stays in English) -----
// Subset: #/##/### headings, paragraphs, "- " lists, **bold**, `code`, [links](https://...).
function mdInline(text, parent) {
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)) {
    let m;
    if (!part) continue;
    if ((m = part.match(/^\*\*([^*]+)\*\*$/))) parent.append(Object.assign(document.createElement('strong'), { textContent: m[1] }));
    else if ((m = part.match(/^`([^`]+)`$/))) parent.append(Object.assign(document.createElement('code'), { textContent: m[1] }));
    else if ((m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)) && /^https?:\/\//.test(m[2])) {
      parent.append(Object.assign(document.createElement('a'), { textContent: m[1], href: m[2], target: '_blank', rel: 'noopener' }));
    } else parent.append(part);
  }
}

function renderMarkdown(md, root) {
  root.replaceChildren();
  let list = null, para = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { list = para = null; continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      list = para = null;
      const h = document.createElement(m[1].length === 1 ? 'h2' : 'h3');
      mdInline(m[2], h);
      if (!root.querySelector('#credits-title')) h.id = 'credits-title'; // the first heading labels the dialog
      root.append(h);
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      para = null;
      if (!list) root.append((list = document.createElement('ul')));
      const li = document.createElement('li');
      mdInline(m[1], li);
      list.append(li);
    } else {
      list = null;
      if (!para) root.append((para = document.createElement('p')));
      else para.append(' ');
      mdInline(line.trim(), para);
    }
  }
}

function initCredits() {
  const dialog = $('credits-dialog');
  const body = $('credits-body');
  let loaded = false;
  $('credits-open').addEventListener('click', async () => {
    dialog.showModal();
    if (loaded) return;
    try {
      const res = await fetch('CREDITS.md');
      if (!res.ok) throw new Error(res.status);
      renderMarkdown(await res.text(), body);
      loaded = true;
    } catch {
      body.replaceChildren();
      const p = document.createElement('p');
      p.append(t('credits.failed'), ' ');
      mdInline(`[CREDITS.md](${CREDITS_SOURCE_URL})`, p);
      body.append(p);
    }
  });
  closable(dialog, $('credits-close'));
}

// ----- Install: hidden in the installed app (CSS display-mode: standalone) -----
let installPrompt = null;
// listen at once: Chrome may offer the prompt before the footer is wired
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function initInstall() {
  const btn = $('install-open');
  const dialog = $('install-dialog');
  addEventListener('appinstalled', () => { installPrompt = null; btn.closest('.foot-install').hidden = true; });
  closable(dialog, $('install-close'));
  btn.addEventListener('click', async () => {
    if (installPrompt) {
      const ev = installPrompt;
      installPrompt = null; // a prompt can be shown only once
      ev.prompt();
      await ev.userChoice;
      return;
    }
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) { dialog.showModal(); return; }
    alert(t(/Firefox/.test(ua) ? 'install.firefox'
      : /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua) ? 'install.safari'
        : 'install.other'));
  });
}

export function initFooter({ onLang }) {
  initLang(onLang);
  initShare();
  initCredits();
  initInstall();
  renderFooter();
}
