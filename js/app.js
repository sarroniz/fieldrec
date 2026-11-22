import { AudioEngine } from './audio.js';
import { parseProtocol, buildSequence, renderMarkdown, renderSlide, layoutPptx, slugify, referencedImages, RECORDING_MODES, QUESTION_TEXT, answerText, isAnswered } from './protocol.js';
import { unzip } from './unzip.js';
import { db } from './db.js';
import { makeZip } from './zip.js';
import { makeTextGrid } from './textgrid.js';
import { guideHTML } from './guide.js';
import { openEditor } from './editor.js';

const APP_VERSION = '0.4.0';
const app = document.getElementById('app');
const engine = new AudioEngine();
let run = null;            // session in progress
let preparedExport = null; // { sessionId, file }

// ---------- utilities ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmtBytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;
const fmtClock = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return iso; } };
const safeName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Texts the participant sees follow the protocol's `language` key (en, es); the rest of the interface is English.
const PARTICIPANT_TEXT = {
  en: { taskOf: (i, n) => `Task ${i} of ${n}`, taskDone: 'Task complete', pause: 'Break', end: 'End of session',
    next: (t) => `Next: <b>${t}</b>`, thanks: 'Thank you for taking part!',
    c1: 'I agree to take part in this study.', c2: 'I agree to have my voice recorded.',
    c3: 'I agree that the recording may be archived for future research (optional).' },
  es: { taskOf: (i, n) => `Tarea ${i} de ${n}`, taskDone: 'Tarea completada', pause: 'Pausa', end: 'Fin de la sesión',
    next: (t) => `Siguiente: <b>${t}</b>`, thanks: '¡Muchas gracias por tu participación!',
    c1: 'Acepto participar en este estudio.', c2: 'Acepto que se grabe mi voz.',
    c3: 'Acepto que la grabación se archive para investigaciones futuras (opcional).' },
};
const langOf = (proto) => String((proto && proto.meta && proto.meta.language) || 'en').slice(0, 2).toLowerCase();
const ptext = (proto) => PARTICIPANT_TEXT[langOf(proto)] || PARTICIPANT_TEXT.en;
const qtext = (proto) => QUESTION_TEXT[langOf(proto)] || QUESTION_TEXT.en;

const SETTINGS_KEY = 'fieldrec.settings';
const DEFAULTS = { sampleRate: 'native', bitDepth: 16, prerollMs: 250, postrollMs: 250, autoAdvance: false, researcher: '', location: '', seenGuide: false };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; } }
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {} }
let settings = loadSettings();

function toast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

function modal({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false, requireCheck = '' }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal-back';
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3><div class="modal-body">${body}</div>
      ${requireCheck ? `<label class="check"><input type="checkbox" id="m-check"> <span>${esc(requireCheck)}</span></label>` : ''}
      <div class="modal-actions">
        ${cancel ? `<button class="btn ghost" data-r="0">${esc(cancel)}</button>` : ''}
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1" ${requireCheck ? 'disabled' : ''}>${esc(ok)}</button>
      </div></div>`;
    document.body.appendChild(m);
    const okBtn = $('[data-r="1"]', m);
    if (requireCheck) $('#m-check', m).addEventListener('change', (e) => { okBtn.disabled = !e.target.checked; });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      m.remove();
      resolve(b.dataset.r === '1');
    });
  });
}

function setScreen(html, cls = '') {
  app.className = cls;
  app.innerHTML = html;
  app.scrollTop = 0;
  window.scrollTo(0, 0);
}

async function storageLine() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return `${fmtBytes(est.usage || 0)} used · ${persisted ? 'persistent storage' : 'storage not persistent'}`;
    }
  } catch (_) {}
  return 'storage usage unknown';
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- protocols: sources ----------
async function listProtocols() {
  const out = [];
  try {
    const r = await fetch('protocols/index.json', { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      for (const p of j.protocols || []) out.push({ id: 'builtin:' + p.id, title: p.title || p.id, kind: 'builtin', path: p.path });
    }
  } catch (_) {}
  try {
    for (const p of await db.all('protocols')) out.push({ id: p.id, title: p.title, kind: 'imported', record: p });
  } catch (_) {}
  return out;
}

const isAbs = (s) => /^(https?:|data:|blob:)/i.test(s);

// Paths inside an imported protocol: no "./", no leading slashes, ".." resolved.
function normPath(p) {
  const out = [];
  for (const seg of String(p || '').replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}
const baseName = (p) => normPath(p).split('/').pop();
const dirName = (p) => { const n = normPath(p); return n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : ''; };
// Files are stored as { type, data: ArrayBuffer } (more reliable than Blob in Safari's IndexedDB)
const toBlob = (v) => (v instanceof Blob ? v : new Blob([v.data], { type: v.type || '' }));
const missingImg = (name) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect x="4" y="4" width="392" height="292" rx="16" fill="#fbf1d6" stroke="#9a6a00" stroke-width="4" stroke-dasharray="14 10"/><text x="200" y="140" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="26" fill="#6b4b00">Missing image</text><text x="200" y="180" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="22" fill="#6b4b00">${esc(baseName(name)).slice(0, 30)}</text></svg>`);

function sourceFor(entry) {
  if (entry.kind === 'builtin') {
    const mainURL = new URL('protocols/' + entry.path, location.href);
    const base = new URL('.', mainURL);
    return {
      mainName: decodeURIComponent(mainURL.pathname.split('/').pop()),
      readText: async (name) => { const r = await fetch(new URL(name, base)); if (!r.ok) throw new Error(`“${name}” not found (HTTP ${r.status})`); return r.text(); },
      resolve: (src) => (isAbs(src) ? src : new URL(src, base).href),
      has: null,
    };
  }
  const files = entry.record.files;
  const byPath = new Map(), byBase = new Map();
  for (const [n, v] of Object.entries(files)) {
    byPath.set(normPath(n).toLowerCase(), v);
    const b = baseName(n).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, v);
  }
  const mainDir = dirName(entry.record.mainName);
  // 1) path relative to the main file, 2) path as written, 3) file name only
  const find = (name) => byPath.get(normPath((mainDir ? mainDir + '/' : '') + name).toLowerCase())
    || byPath.get(normPath(name).toLowerCase()) || byBase.get(baseName(name).toLowerCase());
  const urls = {};
  return {
    mainName: entry.record.mainName,
    readText: async (name) => {
      const v = find(name);
      if (!v) throw new Error(`“${name}” is not among the imported files`);
      return toBlob(v).text();
    },
    resolve: (src) => {
      if (isAbs(src)) return src;
      if (!(src in urls)) { const v = find(src); urls[src] = v ? URL.createObjectURL(toBlob(v)) : missingImg(src); }
      return urls[src];
    },
    has: (name) => !!find(name),
  };
}

// Converts files that v0.1.0 stored as Blob to the current format.
// Safari can lose those Blobs on reload: unreadable files are reported.
async function migrateRecord(rec) {
  const unreadable = [];
  let changed = false;
  for (const [n, v] of Object.entries(rec.files || {})) {
    if (v instanceof Blob) {
      try { rec.files[n] = { type: v.type, data: await v.arrayBuffer() }; changed = true; }
      catch (_) { unreadable.push(n); }
    } else if (!v || !(v.data instanceof ArrayBuffer)) unreadable.push(n);
  }
  if (changed && !unreadable.length) { try { await db.put('protocols', rec); } catch (_) {} }
  return unreadable;
}

class UnreadableProtocol extends Error {}

async function loadProtocolEntry(entry) {
  if (entry.kind === 'imported') {
    const unreadable = await migrateRecord(entry.record);
    if (unreadable.length) {
      throw new UnreadableProtocol(`The browser can no longer read ${unreadable.length === 1 ? 'the stored file' : unreadable.length + ' stored files'} (${unreadable.slice(0, 3).join(', ')}${unreadable.length > 3 ? '…' : ''}).`);
    }
    if (!Object.keys(entry.record.files || {}).length) throw new UnreadableProtocol('The stored protocol contains no files.');
  }
  const src = sourceFor(entry);
  const texts = {};
  const proto = await parseProtocol({
    mainName: src.mainName,
    readText: async (n) => { const t = await src.readText(n); texts[n] = t; return t; },
  });
  if (src.has) {
    for (const img of referencedImages(proto)) {
      if (!src.has(img) && !proto.missing.includes(img)) proto.missing.push(img);
    }
  }
  proto.resolve = src.resolve;
  proto.texts = texts;
  proto.entry = entry;
  return proto;
}

// ---------- HOME ----------
async function screenHome() {
  stopMeterLoop();
  const [sessions, protocols, storage] = await Promise.all([db.all('sessions').catch(() => []), listProtocols(), storageLine()]);
  const pending = sessions.filter((s) => !s.exportedAt).length;
  const standalone = isStandalone();

  setScreen(`
    <div class="page home">
      <header class="brand">
        <div class="logo" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div><h1>Fieldrec</h1><p>Recording and elicitation tasks for fieldwork</p></div>
      </header>
      ${!AudioEngine.supported() ? `<div class="notice warn">This browser can’t record audio at the quality Fieldrec needs. Use an up-to-date Safari (iPadOS 15 or later).</div>` : ''}
      ${!standalone ? `<div class="notice warn"><b>You’re using Fieldrec in a browser tab.</b> Safari deletes a website’s data after 7 days without use, recordings included. Before collecting data, add it to the Home Screen (<b>Share → Add to Home Screen</b>) and open it from there. <a href="#" data-go="guide" data-anchor="g-data">Why?</a></div>` : ''}
      ${!settings.seenGuide ? `<div class="notice">New to Fieldrec? Read the <a href="#" data-go="guide">Guide</a>: getting started, protocol format and how to keep your data safe.</div>` : ''}
      <div class="grid">
        <button class="card primary" data-go="setup">
          <span class="card-ico">●</span><span class="card-t">New session</span>
          <span class="card-s">Choose a protocol and a participant</span>
        </button>
        <button class="card" data-go="sessions">
          <span class="card-ico">▤</span><span class="card-t">Sessions</span>
          <span class="card-s">${sessions.length} saved${pending ? ` · <b>${pending} not exported</b>` : ''}</span>
        </button>
        <button class="card" data-go="protocols">
          <span class="card-ico">☰</span><span class="card-t">Protocols</span>
          <span class="card-s">${protocols.length} available · create · import</span>
        </button>
        <button class="card" data-go="mic">
          <span class="card-ico">◉</span><span class="card-t">Microphone</span>
          <span class="card-s">Check settings and level</span>
        </button>
        <button class="card wide" data-go="guide">
          <span class="card-ico">ⓘ</span><span class="card-t">Guide</span>
          <span class="card-s">Getting started · writing protocols · accepted file types · data safety · troubleshooting</span>
        </button>
      </div>
      <footer class="foot">${esc(storage)} · v${APP_VERSION}</footer>
    </div>`, 'scroll');
  $$('[data-go]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.go, b.dataset.anchor); }));
}

function go(where, arg) {
  if (where === 'home') return screenHome();
  if (where === 'setup') return screenSetup(arg);
  if (where === 'sessions') return screenSessions();
  if (where === 'protocols') return screenProtocols();
  if (where === 'mic') return screenMic();
  if (where === 'guide') return screenGuide(arg);
  if (where === 'editor') return openEditor(editorApi(), arg || {});
}
const editorApi = () => ({ app, setScreen, toast, modal, db, uuid, go, loadProtocolEntry, guessType, toBlob, normPath, downloadBlob, makeZip });

const backBar = (title, right = '') => `
  <header class="topbar"><button class="btn ghost back" data-back>‹ Home</button><h2>${esc(title)}</h2><div class="tb-right">${right}</div></header>`;
function bindBack() { $$('[data-back]').forEach((b) => b.addEventListener('click', () => { if (!run) engine.close(); go('home'); })); }

// ---------- GUIDE ----------
async function screenGuide(anchor) {
  if (!settings.seenGuide) { settings.seenGuide = true; saveSettings(settings); }
  setScreen(`<div class="page guide-page">${backBar('Guide')}
    ${guideHTML({ version: APP_VERSION, storageLine: esc(await storageLine()), standalone: isStandalone() })}</div>`, 'scroll');
  bindBack();
  $$('.toc a, a[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const d = $(a.getAttribute('href'));
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const pre = b.closest('.snippet').querySelector('pre');
    try { await navigator.clipboard.writeText(pre.textContent); toast('Copied'); }
    catch (_) {
      const r = document.createRange(); r.selectNodeContents(pre);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Text selected: use Copy from the menu');
    }
  }));
  if (anchor) { const d = document.getElementById(anchor); if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ block: 'start' }), 50); } }
}

// ---------- level meter ----------
let meterRaf = null, meterPeak = 0, clipUntil = 0;
engine.onLevel((peak, clipped) => {
  meterPeak = Math.max(meterPeak, peak);
  if (clipped) clipUntil = performance.now() + 1200;
});
function startMeterLoop() {
  stopMeterLoop();
  const tick = () => {
    const fill = $('.meter .fill');
    if (fill) {
      const dbfs = meterPeak > 0 ? 20 * Math.log10(meterPeak) : -90;
      const pct = Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
      fill.style.width = pct + '%';
      fill.classList.toggle('hot', dbfs > -6);
      $('.meter').classList.toggle('clipping', performance.now() < clipUntil);
      const lbl = $('.meter-db');
      if (lbl) lbl.textContent = dbfs > -90 ? `${dbfs.toFixed(0)} dBFS` : '—';
    }
    meterPeak *= 0.85;
    updateClock();
    meterRaf = requestAnimationFrame(tick);
  };
  meterRaf = requestAnimationFrame(tick);
}
function stopMeterLoop() { if (meterRaf) cancelAnimationFrame(meterRaf); meterRaf = null; }

// ---------- MICROPHONE ----------
async function screenMic() {
  setScreen(`<div class="page">${backBar('Microphone')}
    <section class="panel">
      <div class="meter big"><div class="fill"></div></div>
      <div class="row between"><span class="meter-db muted">—</span><span class="muted small">The meter turns red when the signal clips</span></div>
      <div class="row gap">
        <button class="btn primary" id="mic-open">Turn on microphone</button>
        <select id="mic-dev" class="hidden"></select>
        <button class="btn" id="mic-test" disabled>Record 5 s test</button>
      </div>
      <audio id="mic-play" controls class="hidden"></audio>
    </section>
    <section class="panel"><h3>Settings accepted by the device</h3><div id="mic-info" class="muted">Turn on the microphone to see them.</div></section>
    <section class="panel"><h3>What to look for</h3><ul class="tips">
      <li><b>Context sample rate</b> is the real capture rate. Choosing a different rate when recording means resampling.</li>
      <li><b>Echo cancellation, noise suppression and automatic gain control</b> should read “no”. If any reads “yes” or “unknown”, iPadOS may be processing the voice.</li>
      <li>If you plug in an external microphone after turning the microphone on, tap “Turn on microphone” again.</li>
    </ul></section></div>`, 'scroll');
  bindBack();
  startMeterLoop();
  const showInfo = async () => {
    const i = engine.info();
    const yn = (v) => (v === true ? '<b class="bad">yes</b>' : v === false ? '<span class="good">no</span>' : '<span class="muted">unknown</span>');
    $('#mic-info').innerHTML = `<table class="kv">
      <tr><th>Input</th><td>${esc(i.inputLabel || '—')}</td></tr>
      <tr><th>Context sample rate</th><td><b>${i.contextSampleRate} Hz</b></td></tr>
      <tr><th>Track sample rate</th><td>${i.obtained.sampleRate ? i.obtained.sampleRate + ' Hz' : '<span class="muted">not reported</span>'}</td></tr>
      <tr><th>Channels</th><td>${i.obtained.channelCount ?? '<span class="muted">not reported</span>'}</td></tr>
      <tr><th>Echo cancellation</th><td>${yn(i.obtained.echoCancellation)}</td></tr>
      <tr><th>Noise suppression</th><td>${yn(i.obtained.noiseSuppression)}</td></tr>
      <tr><th>Automatic gain control</th><td>${yn(i.obtained.autoGainControl)}</td></tr>
      <tr><th>Base latency</th><td>${i.baseLatency != null ? (i.baseLatency * 1000).toFixed(1) + ' ms' : '—'}</td></tr>
    </table>`;
    const devs = await engine.listInputs();
    const sel = $('#mic-dev');
    if (devs.length > 1) {
      sel.classList.remove('hidden');
      sel.innerHTML = devs.map((d, k) => `<option value="${esc(d.deviceId)}" ${engine.deviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Input ' + (k + 1))}</option>`).join('');
    }
  };
  $('#mic-open').addEventListener('click', async () => {
    try { await engine.open(); await engine.ensureRunning(); $('#mic-test').disabled = false; await showInfo(); }
    catch (e) { toast('Couldn’t open the microphone: ' + e.message, 'err'); }
  });
  $('#mic-dev').addEventListener('change', async (e) => {
    try { await engine.useDevice(e.target.value); await showInfo(); } catch (err) { toast(err.message, 'err'); }
  });
  $('#mic-test').addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true;
    try {
      await engine.ensureRunning();
      engine.start(0);
      for (let s = 5; s > 0; s--) { b.textContent = `Recording… ${s}`; await new Promise((r) => setTimeout(r, 1000)); }
      const res = await engine.stop(0);
      const enc = await engine.encode(res.samples, res.sampleRate, res.sampleRate, 16);
      const a = $('#mic-play');
      if (a.src) URL.revokeObjectURL(a.src);
      a.src = URL.createObjectURL(new Blob([enc.full], { type: 'audio/wav' }));
      a.classList.remove('hidden');
      toast(res.clipped ? 'Test recorded (with clipping)' : 'Test recorded', res.clipped ? 'err' : '');
    } catch (err) { toast(err.message, 'err'); }
    b.textContent = 'Record 5 s test'; b.disabled = false;
  });
  if (engine.ctx) { $('#mic-test').disabled = false; showInfo(); }
}

// ---------- PROTOCOLS ----------
const IMPORT_ACCEPT = '.zip,application/zip,.json,application/json,.md,.markdown,.csv,.tsv,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg,image/*,text/*';
const canPickFolder = () => matchMedia('(pointer: fine)').matches && 'webkitdirectory' in document.createElement('input');
const isJunk = (p) => /(^|\/)(__MACOSX|\.git)(\/|$)/.test(p) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(p) || /(^|\/)\._/.test(p);

// Loose files, a folder (desktop) or a ZIP → [{ path, type, data: ArrayBuffer }]
async function collectFiles(fileList) {
  let out = [];
  for (const f of fileList) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
      for (const e of await unzip(f)) out.push({ path: normPath(e.name), type: guessType(e.name), data: e.data });
    } else {
      out.push({ path: normPath(f.webkitRelativePath || f.name), type: f.type || guessType(f.name), data: await f.arrayBuffer() });
    }
  }
  out = out.filter((f) => f.path && !isJunk(f.path));
  // If everything sits inside one folder (e.g. the ZIP of "example-es/"), strip that prefix
  while (out.length && out.every((f) => f.path.includes('/')) && new Set(out.map((f) => f.path.split('/')[0])).size === 1) {
    out.forEach((f) => { f.path = f.path.slice(f.path.indexOf('/') + 1); });
  }
  return out;
}

async function chooseMain(files) {
  const depth = (f) => f.path.split('/').length;
  const byDepth = (a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path);
  const json = files.filter((f) => /(^|\/)protocol\.json$/i.test(f.path)).sort(byDepth)[0];
  if (json) return json;
  const mds = files.filter((f) => /\.(md|markdown)$/i.test(f.path)).sort(byDepth);
  for (const f of mds) {
    if (/^\s*(task|tarea)\s*:/im.test(new TextDecoder().decode(f.data))) return f;
  }
  return mds[0] || files.filter((f) => /\.(csv|tsv)$/i.test(f.path)).sort(byDepth)[0] || null;
}

async function importFiles(fileList, existing = null) {
  const files = await collectFiles(fileList);
  if (!files.length) throw new Error('No valid files were selected');
  let rec = existing;
  if (!rec) {
    const main = await chooseMain(files);
    if (!main) throw new Error('There is no protocol file (protocol.json, .md or .csv). To use a PowerPoint or PDF, choose “From PowerPoint or PDF” instead.');
    rec = { id: 'imp:' + uuid(), title: '', mainName: main.path, files: {}, importedAt: new Date().toISOString() };
  }
  for (const f of files) rec.files[f.path] = { type: f.type, data: f.data };
  const proto = await loadProtocolEntry({ kind: 'imported', record: rec });
  rec.title = proto.title;
  rec.updatedAt = new Date().toISOString();
  await db.put('protocols', rec);
  await db.audit(existing ? 'protocol_updated' : 'protocol_imported', { protocol: rec.title, files: files.length });
  return { rec, proto };
}

function importButtons(id, label, folderLabel) {
  return `<label class="btn primary">${esc(label)}<input type="file" id="${id}" multiple accept="${IMPORT_ACCEPT}" hidden></label>
    ${canPickFolder() ? `<label class="btn">${esc(folderLabel)}<input type="file" id="${id}-dir" webkitdirectory hidden></label>` : ''}`;
}
function bindImport(id, handler) {
  for (const sel of [`#${id}`, `#${id}-dir`]) {
    const el = $(sel);
    if (el) el.addEventListener('change', async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (files.length) await handler(files);
    });
  }
}
const importedToast = (proto) => toast(proto.missing.length ? `Imported, but ${plural(proto.missing.length, 'file is', 'files are')} missing` : `Imported: ${proto.title}`, proto.missing.length ? 'err' : '');

async function screenProtocols(showId) {
  const list = await listProtocols();
  setScreen(`<div class="page">${backBar('Protocols')}
    <section class="panel create">
      <h3>Create a protocol</h3>
      <p class="muted">Build it here step by step: add tasks, then slides (text, pictures, word lists, or a PowerPoint/PDF presentation). No files to write. <a href="#" data-go="guide" data-anchor="g-editor">How it works</a></p>
      <div class="row gap wrap"><button class="btn primary" id="new-proto">New protocol</button><button class="btn" id="new-from-deck">From PowerPoint or PDF</button></div>
    </section>
    <section class="panel">
      <h3>Import a protocol file</h3>
      <p class="muted">For protocols downloaded from Fieldrec (.zip) or written as Markdown/CSV files. The easiest way is a <b>.zip of the protocol folder</b> (in the Files app: long-press the folder → <b>Compress</b>). <a href="#" data-go="guide" data-anchor="g-markdown">Markdown guide</a></p>
      <div class="row gap wrap">${importButtons('imp', 'Import files or .zip', 'Import folder')}</div>
    </section>
    <div class="list">${list.map((p) => `
      <div class="item">
        <div class="item-main"><div class="item-t">${esc(p.title)}</div>
          <div class="item-s">${p.kind === 'builtin' ? 'Included with the app' : `Imported · ${plural(Object.keys(p.record.files).length, 'file', 'files')} · ${fmtDate(p.record.updatedAt || p.record.importedAt)}`}</div></div>
        <div class="item-actions">
          <button class="btn" data-preview="${esc(p.id)}">View</button>
          ${p.kind === 'imported' ? `<button class="btn ghost danger-t" data-del="${esc(p.id)}">Delete</button>` : ''}
        </div>
      </div>`).join('') || '<p class="muted">No protocols.</p>'}</div>
    <div id="preview"></div></div>`, 'scroll');
  bindBack();
  $$('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.go, a.dataset.anchor); }));
  $('#new-proto').addEventListener('click', () => go('editor', {}));
  $('#new-from-deck').addEventListener('click', () => go('editor', { start: 'deck' }));
  bindImport('imp', async (files) => {
    try {
      const { rec, proto } = await importFiles(files);
      importedToast(proto);
      await screenProtocols(rec.id);
    } catch (err) { toast('Import failed: ' + err.message, 'err'); }
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await modal({ title: 'Delete protocol', body: 'Sessions already recorded with it are not deleted.', ok: 'Delete', danger: true }))) return;
    await db.del('protocols', b.dataset.del);
    await db.audit('protocol_deleted', { protocolId: b.dataset.del });
    screenProtocols();
  }));
  $$('[data-preview]').forEach((b) => b.addEventListener('click', () => showPreview(list.find((p) => p.id === b.dataset.preview))));
  if (showId) { const e = list.find((p) => p.id === showId); if (e) showPreview(e); }
}

function guessType(n) {
  const ext = String(n).split('.').pop().toLowerCase();
  return { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain' }[ext] || 'application/octet-stream';
}

// ZIP of a protocol (a template to edit and import again)
async function protocolZip(entry, proto) {
  const folder = slugify(proto.title, 40) || 'protocol';
  const entries = [];
  if (entry.kind === 'imported') {
    for (const [n, v] of Object.entries(entry.record.files)) entries.push({ name: `${folder}/${n}`, data: toBlob(v) });
  } else {
    for (const [n, t] of Object.entries(proto.texts)) entries.push({ name: `${folder}/${normPath(n)}`, data: t });
    for (const img of referencedImages(proto)) {
      try { const r = await fetch(proto.resolve(img)); if (r.ok) entries.push({ name: `${folder}/${normPath(img)}`, data: await r.blob() }); } catch (_) {}
    }
  }
  return new File([await makeZip(entries)], `${folder}.zip`, { type: 'application/zip' });
}

const orderLabel = (t) => (t.randomize === 'full' ? 'fully random' : t.randomize ? 'random within blocks' : 'fixed');

async function showPreview(entry) {
  const box = $('#preview');
  try {
    const p = await loadProtocolEntry(entry);
    const otherWarnings = p.warnings.filter((w) => !w.startsWith('Missing'));
    box.innerHTML = `<section class="panel">
      <h3>${esc(p.title)}</h3>
      ${p.missing.length ? `<div class="notice warn">
        <b>${plural(p.missing.length, 'file used by the protocol is', 'files used by the protocol are')} missing:</b>
        <div class="missing">${p.missing.map((m) => `<code>${esc(m)}</code>`).join(' ')}</div>
        ${entry.kind === 'imported' ? `<div class="row gap wrap">${importButtons('add', 'Add files or .zip', 'Add folder')}</div>
        <small>Files are matched by name, so folders don’t matter.</small>` : ''}
      </div>` : ''}
      ${otherWarnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
      <table class="kv tasks"><tr><th>Task</th><th>Recording</th><th>Slides</th><th>Order</th></tr>
      ${p.tasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${RECORDING_MODES[t.recording]}</td>
        <td>${t.slides.length}${t.repetitions > 1 ? ` × ${t.repetitions}` : ''}</td><td>${orderLabel(t)}</td></tr>`).join('')}
      </table>
      <div class="thumbs">${p.tasks.flatMap((t) => t.slides.slice(0, 4).map((s) =>
        `<div class="thumb"><div class="thumb-in${s.kind === 'pptx' ? ' is-pptx' : ''}">${renderSlide(s, p.resolve)}</div><span>${esc(t.name)} · ${esc(s.id)}</span></div>`)).join('')}</div>
      <div class="row gap wrap">
        <button class="btn primary" id="pv-start" ${p.tasks.length ? '' : 'disabled'}>New session with this protocol</button>
        <button class="btn" id="pv-edit">${entry.kind === 'builtin' ? 'Edit a copy' : 'Edit'}</button>
        <button class="btn" id="pv-zip">Download .zip</button>
      </div>
    </section>`;
    layoutPptx(box);
    $('#pv-start').addEventListener('click', () => go('setup', entry.id));
    $('#pv-edit').addEventListener('click', () => go('editor', { entry }));
    const zipBtn = $('#pv-zip');
    zipBtn.addEventListener('click', async () => {
      zipBtn.disabled = true;
      try { const f = await protocolZip(entry, p); downloadBlob(f, f.name); } catch (err) { toast(err.message, 'err'); }
      zipBtn.disabled = false;
    });
    bindImport('add', async (files) => {
      try {
        const { rec, proto } = await importFiles(files, entry.record);
        toast(proto.missing.length ? `Still missing ${plural(proto.missing.length, 'file', 'files')}` : 'Protocol complete', proto.missing.length ? 'err' : '');
        await screenProtocols(rec.id);
      } catch (err) { toast('Couldn’t add files: ' + err.message, 'err'); }
    });
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    if (err instanceof UnreadableProtocol) {
      box.innerHTML = `<section class="panel"><div class="notice warn"><b>This protocol can’t be opened.</b> ${esc(err.message)}
        It was probably imported with an earlier version of Fieldrec, which stored files in a way Safari can lose when the page reloads.
        Delete it and import it again (preferably as a .zip).</div>
        <div class="row gap wrap"><button class="btn danger" id="pv-del">Delete this protocol</button>${importButtons('reimp', 'Import again', 'Import folder')}</div></section>`;
      $('#pv-del').addEventListener('click', async () => {
        await db.del('protocols', entry.id);
        await db.audit('protocol_deleted', { protocolId: entry.id, protocol: entry.title, reason: 'unreadable' });
        screenProtocols();
      });
      bindImport('reimp', async (files) => {
        try {
          const { rec, proto } = await importFiles(files);
          await db.del('protocols', entry.id);
          importedToast(proto);
          await screenProtocols(rec.id);
        } catch (e) { toast('Import failed: ' + e.message, 'err'); }
      });
    } else {
      box.innerHTML = `<div class="notice warn">Couldn’t read the protocol: ${esc(err.message)}</div>`;
    }
    box.scrollIntoView({ behavior: 'smooth' });
  }
}

// ---------- NEW SESSION ----------
async function screenSetup(preselect) {
  const list = await listProtocols();
  const rateOpt = (v, l) => `<option value="${v}" ${String(settings.sampleRate) === String(v) ? 'selected' : ''}>${l}</option>`;
  setScreen(`<div class="page">${backBar('New session')}
    <form id="setup" class="form" autocomplete="off">
      <section class="panel">
        <h3>Session</h3>
        <label class="field"><span>Protocol</span><select name="protocol" required>
          ${list.map((p) => `<option value="${esc(p.id)}" ${p.id === preselect ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
        <div class="cols">
          <label class="field"><span>Participant code</span><input name="participant" required pattern="[A-Za-z0-9_\\-]{1,24}" placeholder="P01" autocapitalize="characters" spellcheck="false"><small>Letters, numbers, - and _ only. Never a name.</small></label>
          <label class="field"><span>Session</span><input name="session" value="s1" pattern="[A-Za-z0-9_\\-]{1,16}" spellcheck="false"></label>
        </div>
        <div class="cols">
          <label class="field"><span>Researcher</span><input name="researcher" value="${esc(settings.researcher)}"></label>
          <label class="field"><span>Location</span><input name="location" value="${esc(settings.location)}"></label>
        </div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2"></textarea></label>
        <div id="task-pick"></div>
      </section>
      <section class="panel">
        <h3>Audio</h3>
        <div class="cols">
          <label class="field"><span>Sample rate</span><select name="sampleRate">
            ${rateOpt('native', 'Device native')}${rateOpt(48000, '48,000 Hz')}${rateOpt(44100, '44,100 Hz')}${rateOpt(22050, '22,050 Hz')}${rateOpt(16000, '16,000 Hz')}
          </select><small id="rate-note"></small></label>
          <label class="field"><span>Bit depth</span><select name="bitDepth">
            ${[16, 24, 32].map((b) => `<option value="${b}" ${Number(settings.bitDepth) === b ? 'selected' : ''}>${b === 32 ? '32-bit float' : b + '-bit'}</option>`).join('')}
          </select></label>
        </div>
        <div class="cols">
          <label class="field"><span>Pre-roll</span><select name="prerollMs">
            ${[0, 250, 500].map((v) => `<option value="${v}" ${Number(settings.prerollMs) === v ? 'selected' : ''}>${v} ms</option>`).join('')}</select></label>
          <label class="field"><span>Post-roll</span><select name="postrollMs">
            ${[0, 250, 500].map((v) => `<option value="${v}" ${Number(settings.postrollMs) === v ? 'selected' : ''}>${v} ms</option>`).join('')}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="autoAdvance" ${settings.autoAdvance ? 'checked' : ''}> <span>In per-token tasks, go to the next slide when a recording is stopped</span></label>
      </section>
      <div class="actions"><button class="btn primary big" type="submit">Continue to consent</button></div>
    </form></div>`, 'scroll');
  bindBack();
  const form = $('#setup');
  let proto = null;
  const pick = async () => {
    const entry = list.find((p) => p.id === form.protocol.value);
    if (!entry) return;
    try {
      proto = await loadProtocolEntry(entry);
      $('#task-pick').innerHTML = `<div class="field"><span>Tasks</span><div class="chips">
        ${proto.tasks.map((t, i) => `<label class="chip"><input type="checkbox" name="task" value="${i}" checked><span>${esc(t.title)} <em>${RECORDING_MODES[t.recording]}</em></span></label>`).join('')}
        </div></div>${proto.warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}`;
    } catch (err) { proto = null; $('#task-pick').innerHTML = `<div class="notice warn">Couldn’t read the protocol: ${esc(err.message)}</div>`; }
  };
  form.protocol.addEventListener('change', pick);
  await pick();
  const rateNote = () => {
    const v = form.sampleRate.value;
    const n = engine.sampleRate;
    $('#rate-note').textContent = v === 'native' ? (n ? `Will record at ${n} Hz` : 'Usually 48,000 Hz on iPad')
      : n && Number(v) > n ? `Above the real capture rate (${n} Hz): adds no information` : n && Number(v) !== n ? `Will be resampled from ${n} Hz` : '';
  };
  form.sampleRate.addEventListener('change', rateNote); rateNote();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!proto || !proto.tasks.length) return toast('The protocol has no tasks', 'err');
    const fd = new FormData(form);
    const chosen = fd.getAll('task').map(Number);
    if (!chosen.length) return toast('Choose at least one task', 'err');
    settings = {
      ...settings,
      sampleRate: fd.get('sampleRate') === 'native' ? 'native' : Number(fd.get('sampleRate')),
      bitDepth: Number(fd.get('bitDepth')), prerollMs: Number(fd.get('prerollMs')), postrollMs: Number(fd.get('postrollMs')),
      autoAdvance: !!fd.get('autoAdvance'), researcher: fd.get('researcher'), location: fd.get('location'),
    };
    saveSettings(settings);
    try {
      await engine.open();
      await engine.ensureRunning();
    } catch (err) { return toast('Couldn’t open the microphone: ' + err.message, 'err'); }
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
    const participant = safeName(fd.get('participant'));
    const sessionLabel = safeName(fd.get('session')) || 's1';
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0;
    const now = new Date();
    const session = {
      id: uuid(),
      appVersion: APP_VERSION,
      participant, session: sessionLabel,
      folderName: `${participant}_${sessionLabel}_${localDate(now)}`,
      researcher: fd.get('researcher'), location: fd.get('location'), notes: fd.get('notes'),
      createdAt: now.toISOString(), status: 'consent',
      protocol: { title: proto.title, id: proto.entry.id, mainName: Object.keys(proto.texts)[0], language: proto.meta.language || 'en' },
      protocolTexts: proto.texts,
      tasks: chosen.map((i) => ({ name: proto.tasks[i].name, title: proto.tasks[i].title, recording: proto.tasks[i].recording, randomize: proto.tasks[i].randomize, repetitions: proto.tasks[i].repetitions })),
      seed,
      audio: { requestedSampleRate: settings.sampleRate, bitDepth: settings.bitDepth, prerollMs: settings.prerollMs, postrollMs: settings.postrollMs, device: engine.info() },
      device: { userAgent: navigator.userAgent, screen: `${screen.width}x${screen.height}`, pixelRatio: devicePixelRatio, language: navigator.language, standalone: isStandalone() },
      consent: null, trials: [], events: [], persisted: false,
    };
    screenConsent(proto, session, chosen);
  });
}

// ---------- CONSENT ----------
async function persistSession(session) { session.persisted = true; await db.put('sessions', session); }

function screenConsent(proto, session, chosen) {
  const pt = ptext(proto);
  const text = proto.consent ? renderMarkdown(proto.consent, proto.resolve) :
    '<p class="muted">This protocol has no consent text. Add <code>consent: file.md</code> to the protocol header.</p>';
  setScreen(`<div class="page consent">
    <header class="topbar"><button class="btn ghost back" id="c-cancel">‹ Cancel</button><h2>Consent</h2><div class="tb-right muted">${esc(session.participant)}</div></header>
    <section class="panel prose">${text}</section>
    <section class="panel">
      <label class="check big"><input type="checkbox" id="c1"> <span>${esc(pt.c1)}</span></label>
      <label class="check big"><input type="checkbox" id="c2"> <span>${esc(pt.c2)}</span></label>
      <label class="check big"><input type="checkbox" id="c3"> <span>${esc(pt.c3)}</span></label>
      <div class="row gap"><button class="btn" id="c-rec">● Record verbal consent</button><span id="c-rec-st" class="muted small"></span></div>
    </section>
    <div class="actions"><button class="btn primary big" id="c-go" disabled>Start the session</button></div></div>`, 'scroll');
  const upd = () => { $('#c-go').disabled = !($('#c1').checked && $('#c2').checked); };
  $('#c1').addEventListener('change', upd); $('#c2').addEventListener('change', upd);
  let verbalFile = null, recording = false;
  $('#c-rec').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!recording) {
      await engine.ensureRunning();
      engine.start(settings.prerollMs);
      recording = true; b.textContent = '■ Stop'; b.classList.add('rec');
      $('#c-rec-st').textContent = 'Recording…';
    } else {
      recording = false; b.disabled = true;
      const res = await engine.stop(settings.postrollMs);
      const secs = res.samples.length / res.sampleRate;
      if (!session.persisted) await persistSession(session);
      verbalFile = `${session.participant}_${session.session}_verbal_consent.wav`;
      await saveWav(session, res, verbalFile, { task: '_consent', kind: 'consent' });
      b.textContent = '● Record again'; b.classList.remove('rec'); b.disabled = false;
      $('#c-rec-st').textContent = `Saved (${secs.toFixed(1)} s)`;
    }
  });
  $('#c-cancel').addEventListener('click', async () => {
    if (recording) { engine.cancel(); recording = false; }
    if (session.persisted) {
      await db.deleteSession(session.id);
      await db.audit('consent_declined', { sessionId: session.id, participant: session.participant, deletedFiles: true });
    }
    engine.close();
    go('home');
  });
  $('#c-go').addEventListener('click', async () => {
    if (recording) return toast('Stop the consent recording first', 'err');
    session.consent = {
      participate: $('#c1').checked, recording: $('#c2').checked, archive: $('#c3').checked,
      verbalRecording: verbalFile, time: new Date().toISOString(), textIncluded: !!proto.consent,
    };
    session.status = 'in_progress';
    await persistSession(session);
    await db.audit('session_created', { sessionId: session.id, participant: session.participant, protocol: session.protocol.title });
    startRun(proto, session, chosen);
  });
}

// ---------- SAVING ----------
function outRate(nativeRate) { return settings.sampleRate === 'native' ? nativeRate : Number(settings.sampleRate); }

async function saveWav(session, res, name, meta = {}) {
  const rate = outRate(res.sampleRate);
  const enc = await engine.encode(res.samples, res.sampleRate, rate, settings.bitDepth, meta.slices);
  const rec = {
    id: uuid(), sessionId: session.id, name, kind: 'wav', type: 'audio/wav', data: enc.full, size: enc.full.byteLength,
    createdAt: new Date().toISOString(), task: meta.task || '', durationS: enc.length / enc.outRate,
    sampleRate: enc.outRate, nativeRate: res.sampleRate, bitDepth: settings.bitDepth, clipped: !!res.clipped,
  };
  await db.put('files', rec);
  const sliceRecs = [];
  if (meta.sliceNames) {
    for (let i = 0; i < enc.slices.length; i++) {
      const buf = enc.slices[i];
      const r = { id: uuid(), sessionId: session.id, name: meta.sliceNames[i], kind: 'wav', type: 'audio/wav', data: buf, size: buf.byteLength,
        createdAt: rec.createdAt, task: meta.task, sampleRate: enc.outRate, bitDepth: settings.bitDepth, cutFrom: name };
      await db.put('files', r);
      sliceRecs.push(r);
    }
  }
  return { rec, sliceRecs, enc };
}

async function saveText(session, name, text, task) {
  const data = new TextEncoder().encode(text).buffer;
  await db.put('files', { id: uuid(), sessionId: session.id, name, kind: 'text', type: 'text/plain', data, size: data.byteLength, createdAt: new Date().toISOString(), task });
}

// ---------- RUNNING A SESSION ----------
let wakeLock = null;
async function requestWake() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (_) { wakeLock = null; }
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (_) {} wakeLock = null; }

function startRun(proto, session, chosen) {
  run = {
    proto, session,
    tasks: chosen.map((i, k) => ({ task: proto.tasks[i], seq: buildSequence(proto.tasks[i], (session.seed + k * 7919) >>> 0) })),
    ti: 0, si: 0, phase: 'intro',
    rec: null, marks: [], curMark: null, takes: {}, busy: false, interrupted: false, answers: {},
  };
  session.responses = session.responses || [];
  session.order = run.tasks.map((t) => ({ task: t.task.name, order: t.seq.map((x) => `${x.slide.id}#${x.rep}`) }));
  db.put('sessions', session);
  requestWake();
  renderRunnerShell();
  enterTask(0);
}

function renderRunnerShell() {
  setScreen(`<div class="runner">
    <header class="rbar">
      <button class="icon-btn" id="r-menu" aria-label="Menu">☰</button>
      <div class="rtitle"><span id="r-task"></span><span id="r-prog" class="muted"></span></div>
      <div class="recind" id="r-ind"><span class="dot"></span><span id="r-time">00:00</span></div>
      <div class="meter"><div class="fill"></div></div>
    </header>
    <div class="banner hidden" id="r-banner"></div>
    <section class="stage" id="r-stage"><div class="slide" id="r-slide"><div class="content" id="r-content"></div></div></section>
    <footer class="cbar">
      <button class="nav" id="r-prev">‹ Previous</button>
      <div class="cmid"><div id="r-status" class="rstatus"></div><button class="recbtn" id="r-rec" aria-label="Record"><span></span></button></div>
      <button class="nav next" id="r-next">Next ›</button>
    </footer></div>`, 'run');
  $('#r-menu').addEventListener('click', runnerMenu);
  $('#r-prev').addEventListener('click', () => navigate(-1));
  $('#r-next').addEventListener('click', () => navigate(1));
  $('#r-rec').addEventListener('click', toggleTokenRec);
  $('#r-banner').addEventListener('click', resumeAudio);
  startMeterLoop();
}

const curTask = () => run.tasks[run.ti];
const isCont = (t) => t.task.recording === 'continuous' || t.task.recording === 'both';

function enterTask(ti) {
  run.ti = ti; run.si = 0; run.marks = []; run.curMark = null;
  run.phase = curTask().task.instructions ? 'intro' : 'slide';
  if (run.phase === 'slide' && isCont(curTask())) startContinuous().then(showSlide);
  else showSlide();
}

async function startContinuous() {
  await engine.ensureRunning();
  engine.start(settings.prerollMs);
  run.rec = { kind: 'continuous', startedAt: Date.now() };
}

function closeMark() {
  if (!run.curMark) return;
  run.curMark.end = engine.offset();
  run.marks.push(run.curMark);
  run.curMark = null;
}

function showSlide() {
  const t = curTask();
  const total = t.seq.length;
  $('#r-task').textContent = t.task.title;
  const content = $('#r-content');
  const slideEl = $('#r-slide');
  slideEl.className = 'slide';
  const pt = ptext(run.proto);
  if (run.phase === 'intro') {
    $('#r-prog').textContent = `Task ${run.ti + 1} of ${run.tasks.length}`;
    content.innerHTML = `<div class="intro"><div class="eyebrow">${esc(pt.taskOf(run.ti + 1, run.tasks.length))}</div><h1>${esc(t.task.title)}</h1><p>${esc(t.task.instructions)}</p></div>`;
    slideEl.classList.add('is-intro');
  } else if (run.phase === 'done') {
    const next = run.tasks[run.ti + 1];
    $('#r-prog').textContent = '';
    content.innerHTML = `<div class="intro"><div class="eyebrow">${esc(pt.taskDone)}</div><h1>${next ? esc(pt.pause) : esc(pt.end)}</h1>
      <p>${next ? pt.next(esc(next.task.title)) : esc(pt.thanks)}</p></div>`;
    slideEl.classList.add('is-intro');
  } else {
    const x = t.seq[run.si];
    $('#r-prog').textContent = `${run.si + 1} / ${total}`;
    if (x.slide.kind === 'question') {
      slideEl.classList.add('question');
      content.innerHTML = renderSlide(x.slide, run.proto.resolve, { interactive: true, answer: run.answers[takeKey()], texts: qtext(run.proto) });
      bindQuestion(content, x.slide);
    } else content.innerHTML = renderSlide(x.slide, run.proto.resolve);
    if (x.slide.kind === 'question') {
      // questions scroll instead of shrinking
    } else if (x.slide.kind === 'pptx') {
      slideEl.classList.add('pptx');
      layoutPptx(content);
    } else {
      const hasText = !!content.querySelector('p, h1, h2, h3, li');
      const imgs = content.querySelectorAll('img').length;
      slideEl.classList.add(imgs && !hasText ? 'image-only' : imgs ? 'image-text' : 'text-only');
      if (!content.querySelector('p, li') && hasText) slideEl.classList.add('headline');
      $$('img', content).forEach((im) => im.addEventListener('load', () => fitText(), { once: true }));
    }
    if (isCont(t)) {
      closeMark();
      run.curMark = { start: engine.offset(), seqIndex: run.si, slide: x.slide, rep: x.rep, item: x.item, shownAt: new Date().toISOString() };
    }
  }
  fitText();
  updateControls();
}

// Shrinks the font size until the slide fits without scrolling.
function fitText() {
  const slide = $('#r-slide'), content = $('#r-content');
  if (!slide || !content) return;
  if (slide.classList.contains('pptx')) { content.style.fontSize = ''; layoutPptx(content); return; }
  if (slide.classList.contains('question')) { content.style.fontSize = ''; return; }
  const headline = slide.classList.contains('headline') || slide.classList.contains('is-intro');
  const W = slide.clientWidth, H = slide.clientHeight;
  let size = headline ? Math.min(W, H) * 0.09 : Math.min(W, H) * 0.06;
  const min = 14;
  content.style.fontSize = size + 'px';
  let guard = 0;
  while ((content.scrollHeight > H || content.scrollWidth > W) && size > min && guard++ < 60) {
    size *= 0.93;
    content.style.fontSize = size + 'px';
  }
}
window.addEventListener('resize', () => { if (run) fitText(); layoutPptx(document.getElementById('preview')); });

function updateControls() {
  const t = curTask();
  const mode = t.task.recording;
  const recBtn = $('#r-rec'), prev = $('#r-prev'), next = $('#r-next'), status = $('#r-status');
  const inSlide = run.phase === 'slide';
  const tokenRec = run.rec && run.rec.kind === 'token';
  const curSlide = inSlide ? t.seq[run.si].slide : null;
  const isQ = !!curSlide && curSlide.kind === 'question';
  recBtn.classList.toggle('hidden', !(inSlide && mode === 'per_token' && !isQ));
  recBtn.classList.toggle('on', !!tokenRec);
  recBtn.disabled = run.busy;
  prev.disabled = run.busy || run.phase !== 'slide' || run.si === 0;
  next.disabled = run.busy;
  next.textContent = run.phase === 'intro' ? 'Start ›' : run.phase === 'done' ? (run.tasks[run.ti + 1] ? 'Next task ›' : 'Finish ›')
    : run.si === t.seq.length - 1 ? 'Finish task ›' : 'Next ›';
  $('#r-ind').classList.toggle('on', !!run.rec);
  if (run.busy) status.textContent = 'Saving…';
  else if (isQ) {
    const ok = isAnswered(curSlide, run.answers[takeKey()]);
    status.innerHTML = ok ? '<span class="good">✓ Answered</span>' : curSlide.required ? 'Answer to continue' : 'Optional question';
  } else if (inSlide && mode === 'per_token') {
    const n = run.takes[takeKey()] || 0;
    status.innerHTML = tokenRec ? '<b class="rec-t">Recording</b>' : n ? `<span class="good">✓ Take ${n} saved</span>` : 'Tap to record';
  } else if (inSlide && isCont(t)) status.innerHTML = '<b class="rec-t">Continuous recording</b>';
  else if (inSlide && mode === 'none') status.textContent = 'Not recording';
  else status.textContent = '';
}

function updateClock() {
  const el = $('#r-time');
  if (!el || !run) return;
  el.textContent = run.rec ? fmtClock((Date.now() - run.rec.startedAt) / 1000) : '00:00';
}

const takeKey = () => `${run.ti}:${run.si}`;

function fileBase(slideOrder, x) {
  const t = curTask().task;
  const s = run.session;
  return `${s.participant}_${s.session}_${t.name}_${pad(slideOrder + 1)}_${x.slide.id}${t.repetitions > 1 ? `_r${x.rep}` : ''}`;
}

// ---------- questions ----------
function collectAnswer(root, slide) {
  if (slide.qtype === 'single' || slide.qtype === 'multiple') {
    const choices = [...root.querySelectorAll('.q-opt > input:checked')].map((i) => (i.value === 'other' ? 'other' : Number(i.value)));
    const other = root.querySelector('.q-other-text');
    return { choices, other: other ? other.value.trim() : '' };
  }
  const f = root.querySelector('.q-field');
  return { value: f ? f.value.trim() : '' };
}
function bindQuestion(root, slide) {
  const update = () => { run.answers[takeKey()] = collectAnswer(root, slide); const err = root.querySelector('.q-error'); if (err) err.hidden = true; updateControls(); };
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  const other = root.querySelector('.q-other-text');
  if (other) other.addEventListener('focus', () => { const box = other.parentElement.querySelector('input[value="other"]'); if (box && !box.checked) { box.checked = true; update(); } });
  for (const f of root.querySelectorAll('input[type="text"], textarea')) {
    f.addEventListener('focus', () => setTimeout(() => f.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350));
  }
  const field = root.querySelector('input.q-field');
  if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); field.blur(); navigate(1); } });
}
// Saves the answer on the current question slide. With validate, refuses to continue if a required answer is missing.
async function commitQuestion(validate) {
  if (!run || run.phase !== 'slide') return true;
  const t = curTask(); const x = t.seq[run.si];
  if (!x || x.slide.kind !== 'question') return true;
  const root = $('#r-content');
  const ans = collectAnswer(root, x.slide);
  run.answers[takeKey()] = ans;
  if (validate) {
    const pt = qtext(run.proto);
    const err = root.querySelector('.q-error');
    let msg = '';
    if (x.slide.required && !isAnswered(x.slide, ans)) msg = pt.required;
    else if (x.slide.qtype === 'number' && ans.value && !/^-?\d+([.,]\d+)?$/.test(ans.value)) msg = pt.number;
    if (msg) { if (err) { err.textContent = msg; err.hidden = false; } return false; }
  }
  const rec = { task: t.task.name, order: run.si + 1, item: x.item, rep: x.rep, id: x.slide.id, question: x.slide.label, type: x.slide.qtype,
    answer: answerText(x.slide, ans), raw: ans, answered_at: new Date().toISOString() };
  const list = run.session.responses;
  const i = list.findIndex((r) => r.task === rec.task && r.order === rec.order && r.rep === rec.rep);
  if (i >= 0) list[i] = rec; else list.push(rec);
  await db.put('sessions', run.session);
  return true;
}

async function toggleTokenRec() {
  if (run.busy || run.phase !== 'slide') return;
  if (curTask().seq[run.si].slide.kind === 'question') return;
  if (!run.rec) {
    try { await engine.ensureRunning(); } catch (e) { return toast('Microphone unavailable: ' + e.message, 'err'); }
    engine.start(settings.prerollMs);
    run.rec = { kind: 'token', startedAt: Date.now(), shownAt: new Date().toISOString() };
    updateControls();
  } else {
    await stopToken();
    if (settings.autoAdvance) navigate(1, true);
  }
}

async function stopToken() {
  if (!run.rec || run.rec.kind !== 'token') return;
  run.busy = true; updateControls();
  const startedAt = run.rec.shownAt;
  try {
    const res = await engine.stop(settings.postrollMs);
    run.rec = null;
    const t = curTask(); const x = t.seq[run.si];
    const k = takeKey(); run.takes[k] = (run.takes[k] || 0) + 1;
    const take = run.takes[k];
    const name = `${fileBase(run.si, x)}${take > 1 ? `_t${take}` : ''}.wav`;
    const { rec } = await saveWav(run.session, res, name, { task: t.task.name });
    run.session.trials.push({
      task: t.task.name, mode: 'per_token', order: run.si + 1, item: x.item, rep: x.rep, id: x.slide.id, label: x.slide.label,
      take, file: name, onset_s: 0, offset_s: +rec.durationS.toFixed(4), duration_s: +rec.durationS.toFixed(4),
      started_at: startedAt, clipped: !!res.clipped, sample_rate: rec.sampleRate, bit_depth: rec.bitDepth,
    });
    await db.put('sessions', run.session);
    if (res.clipped) toast('Warning: this take is clipped', 'err');
  } catch (e) {
    run.rec = null;
    toast('Couldn’t save: ' + e.message, 'err');
  }
  run.busy = false;
  updateControls();
}

async function finishContinuous() {
  const t = curTask();
  closeMark();
  run.busy = true; updateControls();
  try {
    const res = await engine.stop(settings.postrollMs);
    run.rec = null;
    const s = run.session;
    const base = `${s.participant}_${s.session}_${t.task.name}`;
    const nat = res.sampleRate;
    const total = res.samples.length;
    const marks = run.marks.map((m) => ({ ...m, end: Math.min(m.end, total) }));
    const sliceNames = t.task.recording === 'both'
      ? marks.map((m, i) => `${base}_${pad(i + 1)}_${m.slide.id}${t.task.repetitions > 1 ? `_r${m.rep}` : ''}.wav`) : null;
    const { rec } = await saveWav(s, res, `${base}.wav`, {
      task: t.task.name, slices: sliceNames ? marks.map((m) => [m.start, m.end]) : null, sliceNames,
    });
    const dur = total / nat;
    const tg = makeTextGrid(dur, [
      { name: 'slide', intervals: marks.map((m) => ({ start: m.start / nat, end: m.end / nat, label: `${m.slide.id}${t.task.repetitions > 1 ? '#' + m.rep : ''}` })) },
      { name: 'texto', intervals: marks.map((m) => ({ start: m.start / nat, end: m.end / nat, label: m.slide.label.slice(0, 200) })) },
    ]);
    await saveText(s, `${base}.TextGrid`, tg, t.task.name);
    marks.forEach((m, i) => s.trials.push({
      task: t.task.name, mode: t.task.recording, order: i + 1, item: m.item, rep: m.rep, id: m.slide.id, label: m.slide.label,
      take: 1, file: `${base}.wav`, cut_file: sliceNames ? sliceNames[i] : '',
      onset_s: +(m.start / nat).toFixed(4), offset_s: +(m.end / nat).toFixed(4), duration_s: +((m.end - m.start) / nat).toFixed(4),
      started_at: m.shownAt, clipped: !!res.clipped, sample_rate: rec.sampleRate, bit_depth: rec.bitDepth,
    }));
    await db.put('sessions', s);
    if (res.clipped) toast('Warning: the recording clipped', 'err');
  } catch (e) {
    run.rec = null;
    toast('Couldn’t save the continuous recording: ' + e.message, 'err');
  }
  run.marks = [];
  run.busy = false;
}

async function navigate(dir, fromAuto = false) {
  if (!run || run.busy) return;
  const t = curTask();
  if (run.phase === 'intro') {
    if (dir < 0) return;
    if (isCont(t)) {
      try { await startContinuous(); } catch (e) { return toast('Microphone unavailable: ' + e.message, 'err'); }
    }
    run.phase = 'slide'; run.si = 0;
    return showSlide();
  }
  if (run.phase === 'done') {
    if (dir < 0) return;
    if (run.ti + 1 < run.tasks.length) return enterTask(run.ti + 1);
    return finishSession('complete');
  }
  if (run.rec && run.rec.kind === 'token') await stopToken();
  if (!(await commitQuestion(dir > 0))) return;
  if (dir < 0) {
    if (run.si > 0) { run.si--; showSlide(); }
    return;
  }
  if (run.si < t.seq.length - 1) { run.si++; return showSlide(); }
  // last slide of the task
  if (isCont(t)) await finishContinuous();
  run.phase = 'done';
  showSlide();
}

async function runnerMenu() {
  if (!run) return;
  const m = document.createElement('div');
  m.className = 'modal-back';
  m.innerHTML = `<div class="modal menu"><h3>${esc(run.session.participant)} · ${esc(curTask().task.title)}</h3>
    <button class="btn" data-a="skip">Skip to the end of this task</button>
    <button class="btn" data-a="mic">Reopen microphone</button>
    <button class="btn danger" data-a="end">End session</button>
    <button class="btn ghost" data-a="close">Back</button></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    m.remove();
    if (a.dataset.a === 'skip') {
      await commitQuestion(false);
      if (run.rec && run.rec.kind === 'token') await stopToken();
      if (run.phase === 'slide' && isCont(curTask())) await finishContinuous();
      run.phase = 'done'; showSlide();
    } else if (a.dataset.a === 'mic') {
      resumeAudio();
    } else if (a.dataset.a === 'end') {
      const ok = await modal({ title: 'End session', body: '<p>Anything being recorded will be saved. The session will be marked as incomplete.</p>', ok: 'End session', danger: true });
      if (!ok) return;
      await commitQuestion(false);
      if (run.rec && run.rec.kind === 'token') await stopToken();
      if (run.rec && run.rec.kind === 'continuous') await finishContinuous();
      finishSession('incomplete');
    }
  });
}

async function finishSession(status) {
  const s = run.session;
  s.status = status;
  s.endedAt = new Date().toISOString();
  await db.put('sessions', s);
  await db.audit(status === 'complete' ? 'session_completed' : 'session_ended_early', { sessionId: s.id, participant: s.participant });
  releaseWake();
  stopMeterLoop();
  run = null;
  engine.close();
  const files = await db.fileMeta(s.id);
  setScreen(`<div class="page">
    <header class="topbar"><div></div><h2>Session ${status === 'complete' ? 'complete' : 'ended'}</h2><div></div></header>
    <section class="panel center">
      <h3>${esc(s.participant)} · ${esc(s.session)}</h3>
      <p>${plural(files.filter((f) => f.kind === 'wav').length, 'audio file', 'audio files')} · ${fmtBytes(files.reduce((a, f) => a + f.size, 0))}</p>
      <p class="muted">The recordings only exist on this device. Export the session now to the storage approved by your IRB.</p>
      <div class="row gap center"><button class="btn primary big" id="f-exp">Export now</button><button class="btn big" id="f-home">Home</button></div>
      <div id="f-share"></div>
    </section></div>`, 'scroll');
  $('#f-home').addEventListener('click', () => go('home'));
  $('#f-exp').addEventListener('click', () => prepareExport(s.id, $('#f-share')));
}

// Interruptions (app switch, phone call, screen lock)
function logEvent(type, extra = {}) {
  if (!run) return;
  run.session.events.push({ type, time: new Date().toISOString(), task: curTask().task.name, slide: run.si + 1, recording: !!run.rec, ...extra });
  db.put('sessions', run.session);
}
function showBanner(msg) { const b = $('#r-banner'); if (b) { b.textContent = msg; b.classList.remove('hidden'); } }
async function resumeAudio() {
  try {
    await engine.ensureRunning();
    $('#r-banner') && $('#r-banner').classList.add('hidden');
    if (run) logEvent('audio_resumed');
  } catch (e) { toast('Couldn’t resume audio: ' + e.message, 'err'); }
}
engine.onState((st) => {
  if (!run) return;
  if (st === 'interrupted' || st === 'suspended' || st === 'track-ended') {
    logEvent('audio_interrupted', { state: st });
    showBanner(run.rec ? 'Audio was interrupted and part of the recording is missing. Tap here to resume.' : 'Audio paused. Tap here to resume.');
  }
});
document.addEventListener('visibilitychange', () => {
  if (!run) return;
  if (document.visibilityState === 'hidden') logEvent('app_hidden');
  else {
    logEvent('app_visible');
    requestWake();
    if (!engine.isLive) showBanner('Tap here to resume the microphone.');
  }
});

// Keyboard or presentation remote (arrows / Page Down / Page Up / space)
document.addEventListener('keydown', (e) => {
  if (!run || document.querySelector('.modal-back')) return;
  if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return; // typing an answer
  const k = e.key;
  if (['ArrowRight', 'PageDown', 'ArrowDown'].includes(k)) { e.preventDefault(); navigate(1); }
  else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(k)) { e.preventDefault(); navigate(-1); }
  else if (k === ' ' || k === 'Enter') {
    e.preventDefault();
    const onQuestion = run.phase === 'slide' && curTask().seq[run.si].slide.kind === 'question';
    if (run.phase === 'slide' && curTask().task.recording === 'per_token' && !onQuestion) toggleTokenRec(); else navigate(1);
  } else if (k === 'Escape') runnerMenu();
});

// ---------- SESSIONS AND EXPORT ----------
async function screenSessions() {
  const sessions = (await db.all('sessions')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const metas = await Promise.all(sessions.map((s) => db.fileMeta(s.id)));
  const statusLbl = { complete: 'complete', incomplete: 'incomplete', in_progress: 'interrupted', consent: 'not started' };
  setScreen(`<div class="page">${backBar('Sessions', `<button class="btn" id="audit">Log</button>`)}
    <div class="list">${sessions.map((s, i) => {
      const f = metas[i]; const size = f.reduce((a, x) => a + x.size, 0);
      return `<div class="item" data-id="${esc(s.id)}">
        <div class="item-main">
          <div class="item-t">${esc(s.participant)} · ${esc(s.session)} <span class="tag ${s.exportedAt ? 'ok' : 'warn'}">${s.exportedAt ? 'exported' : 'not exported'}</span></div>
          <div class="item-s">${fmtDate(s.createdAt)} · ${esc(s.protocol.title)} · ${plural(f.filter((x) => x.kind === 'wav').length, 'audio file', 'audio files')} · ${fmtBytes(size)} · ${statusLbl[s.status] || s.status}</div>
          <div class="share-slot"></div>
        </div>
        <div class="item-actions">
          <button class="btn primary" data-exp>Export</button>
          <button class="btn ghost danger-t" data-del>Delete</button>
        </div></div>`;
    }).join('') || '<p class="muted pad">No sessions yet.</p>'}</div></div>`, 'scroll');
  bindBack();
  $$('.item[data-id]').forEach((el) => {
    const id = el.dataset.id;
    $('[data-exp]', el).addEventListener('click', () => prepareExport(id, $('.share-slot', el)));
    $('[data-del]', el).addEventListener('click', async () => {
      const s = sessions.find((x) => x.id === id);
      const ok = await modal({
        title: `Delete ${s.participant} · ${s.session}`,
        body: s.exportedAt ? `<p>Last exported ${fmtDate(s.exportedAt)}.</p>` : '<p><b>This session has never been exported.</b> If you delete it, the recordings will be lost.</p>',
        ok: 'Delete from device', danger: true,
        requireCheck: 'I have checked that the export is saved somewhere safe',
      });
      if (!ok) return;
      const n = await db.deleteSession(id);
      await db.audit('session_deleted', { sessionId: id, participant: s.participant, files: n, wasExported: !!s.exportedAt });
      toast('Session deleted');
      screenSessions();
    });
  });
  $('#audit').addEventListener('click', screenAudit);
}

async function screenAudit() {
  const rows = (await db.all('audit')).reverse();
  const lbl = { session_created: 'Session created', session_completed: 'Session completed', session_ended_early: 'Session ended early',
    protocol_updated: 'Protocol updated', protocol_created: 'Protocol created', export_prepared: 'Export prepared', export_shared: 'Export shared', export_downloaded: 'Export downloaded',
    session_deleted: 'Session deleted', consent_declined: 'Consent declined', protocol_imported: 'Protocol imported', protocol_deleted: 'Protocol deleted' };
  setScreen(`<div class="page">${backBar('Activity log', `<button class="btn" id="a-csv">Export CSV</button>`)}
    <section class="panel"><table class="kv log">${rows.map((r) => `<tr><td class="muted">${fmtDate(r.time)}</td><td>${esc(lbl[r.action] || r.action)}</td><td>${esc(r.participant || r.protocol || '')}</td></tr>`).join('') || '<tr><td class="muted">No activity yet.</td></tr>'}</table></section></div>`, 'scroll');
  bindBack();
  $('#a-csv').addEventListener('click', () => {
    const keys = ['time', 'action', 'sessionId', 'participant', 'protocol', 'files', 'wasExported', 'file'];
    const csv = [keys.join(',')].concat(rows.map((r) => keys.map((k) => csvCell(r[k])).join(','))).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `fieldrec_log_${localDate()}.csv`);
  });
}

function csvCell(v) { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function trialsCSV(s) {
  const keys = ['participant', 'session', 'task', 'mode', 'order', 'item', 'rep', 'id', 'label', 'take', 'file', 'cut_file', 'onset_s', 'offset_s', 'duration_s', 'started_at', 'clipped', 'sample_rate', 'bit_depth'];
  return '﻿' + [keys.join(',')].concat(s.trials.map((t) => keys.map((k) => csvCell(k === 'participant' ? s.participant : k === 'session' ? s.session : t[k])).join(','))).join('\n') + '\n';
}

function responsesCSV(s) {
  const keys = ['participant', 'session', 'task', 'order', 'item', 'rep', 'id', 'question', 'type', 'answer', 'answered_at'];
  return '\uFEFF' + [keys.join(',')].concat(s.responses.map((r) => keys.map((k) => csvCell(k === 'participant' ? s.participant : k === 'session' ? s.session : r[k])).join(','))).join('\n') + '\n';
}

function sessionJSON(s, files) {
  const { protocolTexts, persisted, ...rest } = s;
  return { ...rest, files: files.map(({ blob, data, sessionId, ...f }) => f) };
}

const README_TXT = (s) => `Fieldrec ${APP_VERSION} export
Participant: ${s.participant} · Session: ${s.session} · Date: ${s.createdAt}
Protocol: ${s.protocol.title}

audio/        WAV files (and Praat TextGrids for continuous tasks)
trials.csv    One row per take or interval, with times in seconds
responses.csv Answers to questions (text and multiple choice), if the protocol has any
session.json  Full metadata: requested and obtained audio settings, consent,
              presentation order (seed ${s.seed}), interruptions and device information
protocol/     Copy of the protocol text files used in the session
`;

async function prepareExport(sessionId, slot) {
  slot.innerHTML = '<div class="progress"><div></div></div><span class="muted small">Preparing…</span>';
  try {
    const s = await db.get('sessions', sessionId);
    const files = await db.filesForSession(sessionId);
    files.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
    const F = s.folderName;
    const entries = files.map((f) => ({ name: `${F}/audio/${f.name}`, data: f.data || f.blob }));
    entries.push({ name: `${F}/session.json`, data: JSON.stringify(sessionJSON(s, files), null, 2) });
    entries.push({ name: `${F}/trials.csv`, data: trialsCSV(s) });
    if (s.responses && s.responses.length) entries.push({ name: `${F}/responses.csv`, data: responsesCSV(s) });
    for (const [n, t] of Object.entries(s.protocolTexts || {})) entries.push({ name: `${F}/protocol/${n.split('/').pop()}`, data: t });
    entries.push({ name: `${F}/README.txt`, data: README_TXT(s) });
    const bar = $('.progress div', slot);
    const zip = await makeZip(entries, (p) => { if (bar) bar.style.width = (p * 100).toFixed(0) + '%'; });
    const file = new File([zip], `${F}.zip`, { type: 'application/zip' });
    preparedExport = { sessionId, file };
    await db.audit('export_prepared', { sessionId, participant: s.participant, file: file.name });
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    slot.innerHTML = `<div class="row gap wrap">
      ${canShare ? '<button class="btn primary" data-share>Share / Save to Files</button>' : ''}
      <button class="btn" data-dl>Download ZIP</button>
      <span class="muted small">${esc(file.name)} · ${fmtBytes(file.size)}</span></div>`;
    const mark = async (how) => {
      s.exportedAt = new Date().toISOString();
      s.exports = (s.exports || []).concat([{ time: s.exportedAt, how }]);
      await db.put('sessions', s);
      await db.audit(how === 'share' ? 'export_shared' : 'export_downloaded', { sessionId, participant: s.participant, file: file.name });
    };
    const sh = $('[data-share]', slot);
    if (sh) sh.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: file.name }); await mark('share'); toast('Export shared'); }
      catch (e) { if (e.name !== 'AbortError') toast('Couldn’t share: ' + e.message, 'err'); }
    });
    $('[data-dl]', slot).addEventListener('click', async () => { downloadBlob(file, file.name); await mark('download'); });
  } catch (e) {
    slot.innerHTML = `<div class="notice warn">Export failed: ${esc(e.message)}</div>`;
  }
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ---------- startup ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || run) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
}
window.addEventListener('beforeunload', (e) => { if (run) { e.preventDefault(); e.returnValue = ''; } });
// Block double-tap zoom and pinch gestures during sessions
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.__fieldrec = { engine, get run() { return run; }, db };
screenHome();
