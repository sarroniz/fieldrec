import { AudioEngine } from './audio.js';
import { parseProtocol, buildSequence, renderMarkdown, slugify, referencedImages, RECORDING_MODES } from './protocol.js';
import { unzip } from './unzip.js';
import { db } from './db.js';
import { makeZip } from './zip.js';
import { makeTextGrid } from './textgrid.js';

const APP_VERSION = '0.1.1';
const app = document.getElementById('app');
const engine = new AudioEngine();
let run = null;           // sesión en curso
let preparedExport = null; // { sessionId, file }

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmtBytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;
const fmtClock = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return iso; } };
const safeName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const SETTINGS_KEY = 'fieldrec.settings';
const DEFAULTS = { sampleRate: 'native', bitDepth: 16, prerollMs: 250, postrollMs: 250, autoAdvance: false, researcher: '', location: '' };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; } }
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {} }
let settings = loadSettings();

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

function modal({ title, body = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, requireCheck = '' }) {
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

// ---------- protocolos ----------
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

// Rutas dentro de un protocolo importado: sin "./", sin barras iniciales, con ".." resuelto.
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
// Los archivos se guardan como { type, data: ArrayBuffer } (más fiable que Blob en IndexedDB de Safari)
const toBlob = (v) => (v instanceof Blob ? v : new Blob([v.data], { type: v.type || '' }));
const missingImg = (name) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect x="4" y="4" width="392" height="292" rx="16" fill="#fbf1d6" stroke="#9a6a00" stroke-width="4" stroke-dasharray="14 10"/><text x="200" y="140" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="26" fill="#6b4b00">Falta la imagen</text><text x="200" y="180" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="22" fill="#6b4b00">${esc(baseName(name)).slice(0, 30)}</text></svg>`);

function sourceFor(entry) {
  if (entry.kind === 'builtin') {
    const mainURL = new URL('protocols/' + entry.path, location.href);
    const base = new URL('.', mainURL);
    return {
      mainName: decodeURIComponent(mainURL.pathname.split('/').pop()),
      readText: async (name) => { const r = await fetch(new URL(name, base)); if (!r.ok) throw new Error(name); return r.text(); },
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
  // 1) ruta relativa al archivo principal, 2) ruta tal cual, 3) solo el nombre de archivo
  const find = (name) => byPath.get(normPath((mainDir ? mainDir + '/' : '') + name).toLowerCase())
    || byPath.get(normPath(name).toLowerCase()) || byBase.get(baseName(name).toLowerCase());
  const urls = {};
  return {
    mainName: entry.record.mainName,
    readText: async (name) => { const v = find(name); if (!v) throw new Error(name); return toBlob(v).text(); },
    resolve: (src) => {
      if (isAbs(src)) return src;
      if (!(src in urls)) { const v = find(src); urls[src] = v ? URL.createObjectURL(toBlob(v)) : missingImg(src); }
      return urls[src];
    },
    has: (name) => !!find(name),
  };
}

async function loadProtocolEntry(entry) {
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

// ---------- INICIO ----------
async function screenHome() {
  stopMeterLoop();
  const [sessions, protocols] = await Promise.all([db.all('sessions').catch(() => []), listProtocols()]);
  const pending = sessions.filter((s) => !s.exportedAt).length;
  let storage = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      storage = `${fmtBytes(est.usage || 0)} usados · ${persisted ? 'almacenamiento persistente' : 'almacenamiento no persistente'}`;
    }
  } catch (_) {}
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  setScreen(`
    <div class="page home">
      <header class="brand">
        <div class="logo" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div><h1>Fieldrec</h1><p>Grabación y tareas para trabajo de campo</p></div>
      </header>
      ${!AudioEngine.supported() ? `<div class="notice warn">Este navegador no permite grabar audio con la calidad necesaria. Usa Safari actualizado (iPadOS 15 o posterior).</div>` : ''}
      ${!standalone ? `<div class="notice">Para usarla sin conexión y proteger mejor los datos, añádela a la pantalla de inicio: botón <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>.</div>` : ''}
      <div class="grid">
        <button class="card primary" data-go="setup">
          <span class="card-ico">●</span><span class="card-t">Nueva sesión</span>
          <span class="card-s">Elegir protocolo y participante</span>
        </button>
        <button class="card" data-go="sessions">
          <span class="card-ico">▤</span><span class="card-t">Sesiones</span>
          <span class="card-s">${sessions.length} guardadas${pending ? ` · <b>${pending} sin exportar</b>` : ''}</span>
        </button>
        <button class="card" data-go="protocols">
          <span class="card-ico">☰</span><span class="card-t">Protocolos</span>
          <span class="card-s">${protocols.length} disponibles · importar</span>
        </button>
        <button class="card" data-go="mic">
          <span class="card-ico">◉</span><span class="card-t">Micrófono</span>
          <span class="card-s">Comprobar ajustes y nivel</span>
        </button>
      </div>
      <footer class="foot">${esc(storage)} · v${APP_VERSION}</footer>
    </div>`, 'scroll');
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

function go(where, arg) {
  if (where === 'home') return screenHome();
  if (where === 'setup') return screenSetup(arg);
  if (where === 'sessions') return screenSessions();
  if (where === 'protocols') return screenProtocols();
  if (where === 'mic') return screenMic();
}

const backBar = (title, right = '') => `
  <header class="topbar"><button class="btn ghost back" data-back>‹ Inicio</button><h2>${esc(title)}</h2><div class="tb-right">${right}</div></header>`;
function bindBack() { $$('[data-back]').forEach((b) => b.addEventListener('click', () => { if (!run) engine.close(); go('home'); })); }

// ---------- medidor ----------
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
      const db = meterPeak > 0 ? 20 * Math.log10(meterPeak) : -90;
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      fill.style.width = pct + '%';
      fill.classList.toggle('hot', db > -6);
      const m = $('.meter');
      m.classList.toggle('clipping', performance.now() < clipUntil);
      const lbl = $('.meter-db');
      if (lbl) lbl.textContent = db > -90 ? `${db.toFixed(0)} dBFS` : '—';
    }
    meterPeak *= 0.85;
    updateClock();
    meterRaf = requestAnimationFrame(tick);
  };
  meterRaf = requestAnimationFrame(tick);
}
function stopMeterLoop() { if (meterRaf) cancelAnimationFrame(meterRaf); meterRaf = null; }

// ---------- MICRÓFONO ----------
async function screenMic() {
  setScreen(`<div class="page">${backBar('Micrófono')}
    <section class="panel">
      <div class="meter big"><div class="fill"></div></div>
      <div class="row between"><span class="meter-db muted">—</span><span class="muted small">El indicador se pone rojo si hay saturación</span></div>
      <div class="row gap">
        <button class="btn primary" id="mic-open">Activar micrófono</button>
        <select id="mic-dev" class="hidden"></select>
        <button class="btn" id="mic-test" disabled>Grabar 5 s de prueba</button>
      </div>
      <audio id="mic-play" controls class="hidden"></audio>
    </section>
    <section class="panel"><h3>Ajustes que ha aceptado el dispositivo</h3><div id="mic-info" class="muted">Activa el micrófono para verlos.</div></section>
    <section class="panel"><h3>Qué mirar</h3><ul class="tips">
      <li><b>Frecuencia del contexto</b>: es la frecuencia real de captura. Elegir otra al grabar implica remuestrear.</li>
      <li><b>Cancelación de eco, supresión de ruido y control de ganancia</b> deberían aparecer como «no». Si alguno aparece como «sí» o «desconocido», iOS podría estar procesando la voz.</li>
      <li>Si conectas un micrófono externo después de activar el micrófono, toca «Activar micrófono» otra vez.</li>
    </ul></section></div>`, 'scroll');
  bindBack();
  startMeterLoop();
  const showInfo = async () => {
    const i = engine.info();
    const yn = (v) => (v === true ? '<b class="bad">sí</b>' : v === false ? '<span class="good">no</span>' : '<span class="muted">desconocido</span>');
    $('#mic-info').innerHTML = `<table class="kv">
      <tr><th>Entrada</th><td>${esc(i.inputLabel || '—')}</td></tr>
      <tr><th>Frecuencia del contexto</th><td><b>${i.contextSampleRate} Hz</b></td></tr>
      <tr><th>Frecuencia de la pista</th><td>${i.obtained.sampleRate ? i.obtained.sampleRate + ' Hz' : '<span class="muted">no informada</span>'}</td></tr>
      <tr><th>Canales</th><td>${i.obtained.channelCount ?? '<span class="muted">no informado</span>'}</td></tr>
      <tr><th>Cancelación de eco</th><td>${yn(i.obtained.echoCancellation)}</td></tr>
      <tr><th>Supresión de ruido</th><td>${yn(i.obtained.noiseSuppression)}</td></tr>
      <tr><th>Control automático de ganancia</th><td>${yn(i.obtained.autoGainControl)}</td></tr>
      <tr><th>Latencia base</th><td>${i.baseLatency != null ? (i.baseLatency * 1000).toFixed(1) + ' ms' : '—'}</td></tr>
    </table>`;
    const devs = await engine.listInputs();
    const sel = $('#mic-dev');
    if (devs.length > 1) {
      sel.classList.remove('hidden');
      sel.innerHTML = devs.map((d, k) => `<option value="${esc(d.deviceId)}" ${engine.deviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Entrada ' + (k + 1))}</option>`).join('');
    }
  };
  $('#mic-open').addEventListener('click', async () => {
    try { await engine.open(); await engine.ensureRunning(); $('#mic-test').disabled = false; await showInfo(); }
    catch (e) { toast('No se pudo abrir el micrófono: ' + e.message, 'err'); }
  });
  $('#mic-dev').addEventListener('change', async (e) => {
    try { await engine.useDevice(e.target.value); await showInfo(); } catch (err) { toast(err.message, 'err'); }
  });
  $('#mic-test').addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true;
    try {
      await engine.ensureRunning();
      engine.start(0);
      for (let s = 5; s > 0; s--) { b.textContent = `Grabando… ${s}`; await new Promise((r) => setTimeout(r, 1000)); }
      const res = await engine.stop(0);
      const enc = await engine.encode(res.samples, res.sampleRate, res.sampleRate, 16);
      const a = $('#mic-play');
      if (a.src) URL.revokeObjectURL(a.src);
      a.src = URL.createObjectURL(new Blob([enc.full], { type: 'audio/wav' }));
      a.classList.remove('hidden');
      toast(res.clipped ? 'Prueba grabada (con saturación)' : 'Prueba grabada', res.clipped ? 'err' : '');
    } catch (err) { toast(err.message, 'err'); }
    b.textContent = 'Grabar 5 s de prueba'; b.disabled = false;
  });
  if (engine.ctx) { $('#mic-test').disabled = false; showInfo(); }
}

// ---------- PROTOCOLOS ----------
const IMPORT_ACCEPT = '.zip,application/zip,.md,.markdown,.csv,.tsv,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg,image/*,text/*';
const canPickFolder = () => matchMedia('(pointer: fine)').matches && 'webkitdirectory' in document.createElement('input');
const isJunk = (p) => /(^|\/)(__MACOSX|\.git)(\/|$)/.test(p) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(p) || /(^|\/)\._/.test(p);

// Archivos sueltos, una carpeta (escritorio) o ZIP → [{ path, type, data: ArrayBuffer }]
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
  // Si todo está dentro de una misma carpeta (p. ej. el ZIP de «ejemplo/»), se quita ese prefijo
  while (out.length && out.every((f) => f.path.includes('/')) && new Set(out.map((f) => f.path.split('/')[0])).size === 1) {
    out.forEach((f) => { f.path = f.path.slice(f.path.indexOf('/') + 1); });
  }
  return out;
}

async function chooseMain(files) {
  const depth = (f) => f.path.split('/').length;
  const byDepth = (a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path);
  const mds = files.filter((f) => /\.(md|markdown)$/i.test(f.path)).sort(byDepth);
  for (const f of mds) {
    if (/^\s*(task|tarea)\s*:/im.test(new TextDecoder().decode(f.data))) return f;
  }
  return mds[0] || files.filter((f) => /\.(csv|tsv)$/i.test(f.path)).sort(byDepth)[0] || null;
}

async function importFiles(fileList, existing = null) {
  const files = await collectFiles(fileList);
  if (!files.length) throw new Error('No se ha seleccionado ningún archivo válido');
  let rec = existing;
  if (!rec) {
    const main = await chooseMain(files);
    if (!main) throw new Error('No hay ningún archivo de protocolo (.md o .csv)');
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

function importButtons(id, label) {
  return `<label class="btn primary">${esc(label)}<input type="file" id="${id}" multiple accept="${IMPORT_ACCEPT}" hidden></label>
    ${canPickFolder() ? `<label class="btn">${label.startsWith('Añadir') ? 'Añadir carpeta' : 'Importar carpeta'}<input type="file" id="${id}-dir" webkitdirectory hidden></label>` : ''}`;
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

async function screenProtocols(showId) {
  const list = await listProtocols();
  setScreen(`<div class="page">${backBar('Protocolos')}
    <section class="panel">
      <h3>Importar un protocolo</h3>
      <p class="muted">La forma más sencilla es un <b>.zip con la carpeta del protocolo</b> (en la app Archivos: mantén pulsada la carpeta → <b>Comprimir</b>). También puedes seleccionar a la vez el archivo <b>.md</b> o <b>.csv</b> y los archivos que usa; si falta alguno, podrás añadirlo después.</p>
      <div class="row gap wrap">${importButtons('imp', 'Importar archivos o .zip')}</div>
    </section>
    <div class="list">${list.map((p) => `
      <div class="item">
        <div class="item-main"><div class="item-t">${esc(p.title)}</div>
          <div class="item-s">${p.kind === 'builtin' ? 'Incluido en la web' : `Importado · ${Object.keys(p.record.files).length} archivos · ${fmtDate(p.record.updatedAt || p.record.importedAt)}`}</div></div>
        <div class="item-actions">
          <button class="btn" data-preview="${esc(p.id)}">Ver</button>
          ${p.kind === 'imported' ? `<button class="btn ghost danger-t" data-del="${esc(p.id)}">Borrar</button>` : ''}
        </div>
      </div>`).join('') || '<p class="muted">No hay protocolos.</p>'}</div>
    <div id="preview"></div></div>`, 'scroll');
  bindBack();
  bindImport('imp', async (files) => {
    try {
      const { rec, proto } = await importFiles(files);
      toast(proto.missing.length ? `Importado, pero faltan ${proto.missing.length} archivos` : `Importado: ${proto.title}`, proto.missing.length ? 'err' : '');
      await screenProtocols(rec.id);
    } catch (err) { toast('Error al importar: ' + err.message, 'err'); }
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await modal({ title: 'Borrar protocolo', body: 'Las sesiones ya grabadas con él no se borran.', ok: 'Borrar', danger: true }))) return;
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

// ZIP del protocolo (plantilla para editar y volver a importar)
async function protocolZip(entry, proto) {
  const folder = slugify(proto.title, 40) || 'protocolo';
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

async function showPreview(entry) {
  const box = $('#preview');
  try {
    const p = await loadProtocolEntry(entry);
    const otherWarnings = p.warnings.filter((w) => !w.startsWith('Falta'));
    box.innerHTML = `<section class="panel">
      <h3>${esc(p.title)}</h3>
      ${p.missing.length ? `<div class="notice warn">
        <b>Faltan ${p.missing.length} ${p.missing.length === 1 ? 'archivo' : 'archivos'} que usa el protocolo:</b>
        <div class="missing">${p.missing.map((m) => `<code>${esc(m)}</code>`).join(' ')}</div>
        ${entry.kind === 'imported' ? `<div class="row gap wrap">${importButtons('add', 'Añadir archivos o .zip')}</div>
        <small>Se emparejan por nombre: no hace falta respetar las carpetas.</small>` : ''}
      </div>` : ''}
      ${otherWarnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
      <table class="kv tasks"><tr><th>Tarea</th><th>Grabación</th><th>Slides</th><th>Orden</th></tr>
      ${p.tasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${RECORDING_MODES[t.recording]}</td>
        <td>${t.slides.length}${t.repetitions > 1 ? ` × ${t.repetitions}` : ''}</td>
        <td>${t.randomize === 'full' ? 'aleatorio total' : t.randomize ? 'aleatorio por bloques' : 'fijo'}</td></tr>`).join('')}
      </table>
      <div class="thumbs">${p.tasks.flatMap((t) => t.slides.slice(0, 4).map((s) =>
        `<div class="thumb"><div class="thumb-in">${renderMarkdown(s.md, p.resolve)}</div><span>${esc(t.name)} · ${esc(s.id)}</span></div>`)).join('')}</div>
      <div class="row gap wrap">
        <button class="btn primary" id="pv-start" ${p.tasks.length ? '' : 'disabled'}>Nueva sesión con este protocolo</button>
        <button class="btn" id="pv-zip">Descargar .zip</button>
      </div>
    </section>`;
    $('#pv-start').addEventListener('click', () => go('setup', entry.id));
    const zipBtn = $('#pv-zip');
    zipBtn.addEventListener('click', async () => {
      zipBtn.disabled = true;
      try { const f = await protocolZip(entry, p); downloadBlob(f, f.name); } catch (err) { toast(err.message, 'err'); }
      zipBtn.disabled = false;
    });
    bindImport('add', async (files) => {
      try {
        const { rec, proto } = await importFiles(files, entry.record);
        toast(proto.missing.length ? `Siguen faltando ${proto.missing.length} archivos` : 'Protocolo completo', proto.missing.length ? 'err' : '');
        await screenProtocols(rec.id);
      } catch (err) { toast('Error al añadir: ' + err.message, 'err'); }
    });
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { box.innerHTML = `<div class="notice warn">No se pudo leer el protocolo: ${esc(err.message)}</div>`; }
}

// ---------- NUEVA SESIÓN ----------
async function screenSetup(preselect) {
  const list = await listProtocols();
  const rateOpt = (v, l) => `<option value="${v}" ${String(settings.sampleRate) === String(v) ? 'selected' : ''}>${l}</option>`;
  setScreen(`<div class="page">${backBar('Nueva sesión')}
    <form id="setup" class="form" autocomplete="off">
      <section class="panel">
        <h3>Sesión</h3>
        <label class="field"><span>Protocolo</span><select name="protocol" required>
          ${list.map((p) => `<option value="${esc(p.id)}" ${p.id === preselect ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
        <div class="cols">
          <label class="field"><span>Código de participante</span><input name="participant" required pattern="[A-Za-z0-9_\\-]{1,24}" placeholder="P01" autocapitalize="characters" spellcheck="false"><small>Solo letras, números, - y _. Nunca el nombre.</small></label>
          <label class="field"><span>Sesión</span><input name="session" value="s1" pattern="[A-Za-z0-9_\\-]{1,16}" spellcheck="false"></label>
        </div>
        <div class="cols">
          <label class="field"><span>Investigador/a</span><input name="researcher" value="${esc(settings.researcher)}"></label>
          <label class="field"><span>Lugar</span><input name="location" value="${esc(settings.location)}"></label>
        </div>
        <label class="field"><span>Notas</span><textarea name="notes" rows="2"></textarea></label>
        <div id="task-pick"></div>
      </section>
      <section class="panel">
        <h3>Audio</h3>
        <div class="cols">
          <label class="field"><span>Frecuencia de muestreo</span><select name="sampleRate">
            ${rateOpt('native', 'Nativa del dispositivo')}${rateOpt(48000, '48 000 Hz')}${rateOpt(44100, '44 100 Hz')}${rateOpt(22050, '22 050 Hz')}${rateOpt(16000, '16 000 Hz')}
          </select><small id="rate-note"></small></label>
          <label class="field"><span>Profundidad</span><select name="bitDepth">
            ${[16, 24, 32].map((b) => `<option value="${b}" ${Number(settings.bitDepth) === b ? 'selected' : ''}>${b === 32 ? '32 bits float' : b + ' bits'}</option>`).join('')}
          </select></label>
        </div>
        <div class="cols">
          <label class="field"><span>Margen previo (pre-roll)</span><select name="prerollMs">
            ${[0, 250, 500].map((v) => `<option value="${v}" ${Number(settings.prerollMs) === v ? 'selected' : ''}>${v} ms</option>`).join('')}</select></label>
          <label class="field"><span>Margen posterior</span><select name="postrollMs">
            ${[0, 250, 500].map((v) => `<option value="${v}" ${Number(settings.postrollMs) === v ? 'selected' : ''}>${v} ms</option>`).join('')}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="autoAdvance" ${settings.autoAdvance ? 'checked' : ''}> <span>En tareas por token, pasar a la siguiente slide al parar la grabación</span></label>
      </section>
      <div class="actions"><button class="btn primary big" type="submit">Continuar al consentimiento</button></div>
    </form></div>`, 'scroll');
  bindBack();
  const form = $('#setup');
  let proto = null;
  const pick = async () => {
    const entry = list.find((p) => p.id === form.protocol.value);
    if (!entry) return;
    try {
      proto = await loadProtocolEntry(entry);
      $('#task-pick').innerHTML = `<div class="field"><span>Tareas</span><div class="chips">
        ${proto.tasks.map((t, i) => `<label class="chip"><input type="checkbox" name="task" value="${i}" checked><span>${esc(t.title)} <em>${RECORDING_MODES[t.recording]}</em></span></label>`).join('')}
        </div></div>${proto.warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}`;
    } catch (err) { proto = null; $('#task-pick').innerHTML = `<div class="notice warn">No se pudo leer el protocolo: ${esc(err.message)}</div>`; }
  };
  form.protocol.addEventListener('change', pick);
  await pick();
  const rateNote = () => {
    const v = form.sampleRate.value;
    const n = engine.sampleRate;
    $('#rate-note').textContent = v === 'native' ? (n ? `Se grabará a ${n} Hz` : 'Normalmente 48 000 Hz en iPad')
      : n && Number(v) > n ? `Por encima de la captura real (${n} Hz): no añade información` : n && Number(v) !== n ? `Se remuestreará desde ${n} Hz` : '';
  };
  form.sampleRate.addEventListener('change', rateNote); rateNote();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!proto || !proto.tasks.length) return toast('El protocolo no tiene tareas', 'err');
    const fd = new FormData(form);
    const chosen = fd.getAll('task').map(Number);
    if (!chosen.length) return toast('Elige al menos una tarea', 'err');
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
    } catch (err) { return toast('No se pudo abrir el micrófono: ' + err.message, 'err'); }
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
      protocol: { title: proto.title, id: proto.entry.id, mainName: Object.keys(proto.texts)[0] },
      protocolTexts: proto.texts,
      tasks: chosen.map((i) => ({ name: proto.tasks[i].name, title: proto.tasks[i].title, recording: proto.tasks[i].recording, randomize: proto.tasks[i].randomize, repetitions: proto.tasks[i].repetitions })),
      seed,
      audio: { requestedSampleRate: settings.sampleRate, bitDepth: settings.bitDepth, prerollMs: settings.prerollMs, postrollMs: settings.postrollMs, device: engine.info() },
      device: { userAgent: navigator.userAgent, screen: `${screen.width}x${screen.height}`, pixelRatio: devicePixelRatio, language: navigator.language },
      consent: null, trials: [], events: [], persisted: false,
    };
    screenConsent(proto, session, chosen);
  });
}

// ---------- CONSENTIMIENTO ----------
async function persistSession(session) { session.persisted = true; await db.put('sessions', session); }

function screenConsent(proto, session, chosen) {
  const text = proto.consent ? renderMarkdown(proto.consent, proto.resolve) :
    '<p class="muted">Este protocolo no incluye texto de consentimiento. Añade <code>consent: archivo.md</code> en la cabecera del protocolo.</p>';
  setScreen(`<div class="page consent">
    <header class="topbar"><button class="btn ghost back" id="c-cancel">‹ Cancelar</button><h2>Consentimiento</h2><div class="tb-right muted">${esc(session.participant)}</div></header>
    <section class="panel prose">${text}</section>
    <section class="panel">
      <label class="check big"><input type="checkbox" id="c1"> <span>Acepto participar en este estudio.</span></label>
      <label class="check big"><input type="checkbox" id="c2"> <span>Acepto que se grabe mi voz.</span></label>
      <label class="check big"><input type="checkbox" id="c3"> <span>Acepto que la grabación se archive para investigaciones futuras (opcional).</span></label>
      <div class="row gap"><button class="btn" id="c-rec">● Grabar consentimiento verbal</button><span id="c-rec-st" class="muted small"></span></div>
    </section>
    <div class="actions"><button class="btn primary big" id="c-go" disabled>Empezar la sesión</button></div></div>`, 'scroll');
  const upd = () => { $('#c-go').disabled = !($('#c1').checked && $('#c2').checked); };
  $('#c1').addEventListener('change', upd); $('#c2').addEventListener('change', upd);
  let verbalFile = null, recording = false;
  $('#c-rec').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!recording) {
      await engine.ensureRunning();
      engine.start(settings.prerollMs);
      recording = true; b.textContent = '■ Parar'; b.classList.add('rec');
      $('#c-rec-st').textContent = 'Grabando…';
    } else {
      recording = false; b.disabled = true;
      const res = await engine.stop(settings.postrollMs);
      const secs = res.samples.length / res.sampleRate;
      if (!session.persisted) await persistSession(session);
      verbalFile = `${session.participant}_${session.session}_consentimiento_verbal.wav`;
      await saveWav(session, res, verbalFile, { task: '_consentimiento', kind: 'consent' });
      b.textContent = '● Volver a grabar'; b.classList.remove('rec'); b.disabled = false;
      $('#c-rec-st').textContent = `Guardado (${secs.toFixed(1)} s)`;
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
    if (recording) return toast('Para primero la grabación del consentimiento', 'err');
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

// ---------- GUARDADO ----------
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

// ---------- EJECUCIÓN DE LA SESIÓN ----------
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
    rec: null, marks: [], curMark: null, takes: {}, busy: false, interrupted: false,
  };
  session.order = run.tasks.map((t) => ({ task: t.task.name, order: t.seq.map((x) => `${x.slide.id}#${x.rep}`) }));
  db.put('sessions', session);
  requestWake();
  renderRunnerShell();
  enterTask(0);
}

function renderRunnerShell() {
  setScreen(`<div class="runner">
    <header class="rbar">
      <button class="icon-btn" id="r-menu" aria-label="Menú">☰</button>
      <div class="rtitle"><span id="r-task"></span><span id="r-prog" class="muted"></span></div>
      <div class="recind" id="r-ind"><span class="dot"></span><span id="r-time">00:00</span></div>
      <div class="meter"><div class="fill"></div></div>
    </header>
    <div class="banner hidden" id="r-banner"></div>
    <section class="stage" id="r-stage"><div class="slide" id="r-slide"><div class="content" id="r-content"></div></div></section>
    <footer class="cbar">
      <button class="nav" id="r-prev">‹ Anterior</button>
      <div class="cmid"><div id="r-status" class="rstatus"></div><button class="recbtn" id="r-rec" aria-label="Grabar"><span></span></button></div>
      <button class="nav next" id="r-next">Siguiente ›</button>
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
  if (run.phase === 'intro') {
    $('#r-prog').textContent = `Tarea ${run.ti + 1} de ${run.tasks.length}`;
    content.innerHTML = `<div class="intro"><div class="eyebrow">Tarea ${run.ti + 1} de ${run.tasks.length}</div><h1>${esc(t.task.title)}</h1><p>${esc(t.task.instructions)}</p></div>`;
    slideEl.classList.add('is-intro');
  } else if (run.phase === 'done') {
    const next = run.tasks[run.ti + 1];
    $('#r-prog').textContent = '';
    content.innerHTML = `<div class="intro"><div class="eyebrow">Tarea completada</div><h1>${next ? 'Pausa' : 'Fin de la sesión'}</h1>
      <p>${next ? `Siguiente: <b>${esc(next.task.title)}</b>` : '¡Muchas gracias por tu participación!'}</p></div>`;
    slideEl.classList.add('is-intro');
  } else {
    const x = t.seq[run.si];
    $('#r-prog').textContent = `${run.si + 1} / ${total}`;
    content.innerHTML = renderMarkdown(x.slide.md, run.proto.resolve);
    const hasText = !!content.querySelector('p, h1, h2, h3, li');
    const imgs = content.querySelectorAll('img').length;
    slideEl.classList.add(imgs && !hasText ? 'image-only' : imgs ? 'image-text' : 'text-only');
    if (!content.querySelector('p, li') && hasText) slideEl.classList.add('headline');
    $$('img', content).forEach((im) => im.addEventListener('load', () => fitText(), { once: true }));
    if (isCont(t)) {
      closeMark();
      run.curMark = { start: engine.offset(), seqIndex: run.si, slide: x.slide, rep: x.rep, item: x.item, shownAt: new Date().toISOString() };
    }
  }
  fitText();
  updateControls();
}

// Ajusta el tamaño de letra para que la slide quepa sin desplazamiento.
function fitText() {
  const slide = $('#r-slide'), content = $('#r-content');
  if (!slide || !content) return;
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
window.addEventListener('resize', () => { if (run) fitText(); });

function updateControls() {
  const t = curTask();
  const mode = t.task.recording;
  const recBtn = $('#r-rec'), prev = $('#r-prev'), next = $('#r-next'), status = $('#r-status');
  const inSlide = run.phase === 'slide';
  const tokenRec = run.rec && run.rec.kind === 'token';
  recBtn.classList.toggle('hidden', !(inSlide && mode === 'per_token'));
  recBtn.classList.toggle('on', !!tokenRec);
  recBtn.disabled = run.busy;
  prev.disabled = run.busy || run.phase !== 'slide' || run.si === 0 || (isCont(t) && run.si === 0);
  next.disabled = run.busy;
  next.textContent = run.phase === 'intro' ? 'Empezar ›' : run.phase === 'done' ? (run.tasks[run.ti + 1] ? 'Siguiente tarea ›' : 'Terminar ›')
    : run.si === t.seq.length - 1 ? 'Terminar tarea ›' : 'Siguiente ›';
  $('#r-ind').classList.toggle('on', !!run.rec);
  if (run.busy) status.textContent = 'Guardando…';
  else if (inSlide && mode === 'per_token') {
    const k = takeKey(); const n = run.takes[k] || 0;
    status.innerHTML = tokenRec ? '<b class="rec-t">Grabando</b>' : n ? `<span class="good">✓ Toma ${n} guardada</span>` : 'Toca para grabar';
  } else if (inSlide && isCont(t)) status.innerHTML = `<b class="rec-t">Grabación continua</b>`;
  else if (inSlide && mode === 'none') status.textContent = 'Sin grabación';
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

async function toggleTokenRec() {
  if (run.busy || run.phase !== 'slide') return;
  if (!run.rec) {
    try { await engine.ensureRunning(); } catch (e) { return toast('Micrófono no disponible: ' + e.message, 'err'); }
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
    if (res.clipped) toast('Atención: la toma tiene saturación', 'err');
  } catch (e) {
    run.rec = null;
    toast('Error al guardar: ' + e.message, 'err');
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
    if (res.clipped) toast('Atención: hubo saturación en la grabación', 'err');
  } catch (e) {
    run.rec = null;
    toast('Error al guardar la grabación continua: ' + e.message, 'err');
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
      try { await startContinuous(); } catch (e) { return toast('Micrófono no disponible: ' + e.message, 'err'); }
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
  if (dir < 0) {
    if (run.si > 0) { run.si--; showSlide(); }
    return;
  }
  if (run.si < t.seq.length - 1) { run.si++; return showSlide(); }
  // última slide de la tarea
  if (isCont(t)) await finishContinuous();
  run.phase = 'done';
  showSlide();
}

async function runnerMenu() {
  if (!run) return;
  const m = document.createElement('div');
  m.className = 'modal-back';
  m.innerHTML = `<div class="modal menu"><h3>${esc(run.session.participant)} · ${esc(curTask().task.title)}</h3>
    <button class="btn" data-a="skip">Saltar al final de esta tarea</button>
    <button class="btn" data-a="mic">Reabrir el micrófono</button>
    <button class="btn danger" data-a="end">Terminar la sesión</button>
    <button class="btn ghost" data-a="close">Volver</button></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    m.remove();
    if (a.dataset.a === 'skip') {
      if (run.rec && run.rec.kind === 'token') await stopToken();
      if (run.phase === 'slide' && isCont(curTask())) await finishContinuous();
      run.phase = 'done'; showSlide();
    } else if (a.dataset.a === 'mic') {
      resumeAudio();
    } else if (a.dataset.a === 'end') {
      const ok = await modal({ title: 'Terminar la sesión', body: '<p>Lo que esté grabándose se guardará. La sesión quedará marcada como incompleta.</p>', ok: 'Terminar', danger: true });
      if (!ok) return;
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
    <header class="topbar"><div></div><h2>Sesión ${status === 'complete' ? 'completada' : 'terminada'}</h2><div></div></header>
    <section class="panel center">
      <h3>${esc(s.participant)} · ${esc(s.session)}</h3>
      <p>${files.filter((f) => f.kind === 'wav').length} archivos de audio · ${fmtBytes(files.reduce((a, f) => a + f.size, 0))}</p>
      <p class="muted">Exporta la sesión cuanto antes al almacenamiento aprobado por tu IRB.</p>
      <div class="row gap center"><button class="btn primary big" id="f-exp">Exportar ahora</button><button class="btn big" id="f-home">Inicio</button></div>
      <div id="f-share"></div>
    </section></div>`, 'scroll');
  $('#f-home').addEventListener('click', () => go('home'));
  $('#f-exp').addEventListener('click', () => prepareExport(s.id, $('#f-share')));
}

// Interrupciones (cambio de app, llamada, bloqueo de pantalla)
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
  } catch (e) { toast('No se pudo reanudar el audio: ' + e.message, 'err'); }
}
engine.onState((st) => {
  if (!run) return;
  if (st === 'interrupted' || st === 'suspended' || st === 'track-ended') {
    logEvent('audio_interrupted', { state: st });
    showBanner(run.rec ? 'El audio se ha interrumpido y falta un fragmento. Toca aquí para reanudar.' : 'Audio en pausa. Toca aquí para reanudar.');
  }
});
document.addEventListener('visibilitychange', () => {
  if (!run) return;
  if (document.visibilityState === 'hidden') logEvent('app_hidden');
  else {
    logEvent('app_visible');
    requestWake();
    if (!engine.isLive) showBanner('Toca aquí para reanudar el micrófono.');
  }
});

// Teclado o mando de presentaciones (flechas / AvPág / RePág / espacio)
document.addEventListener('keydown', (e) => {
  if (!run || document.querySelector('.modal-back')) return;
  const k = e.key;
  if (['ArrowRight', 'PageDown', 'ArrowDown'].includes(k)) { e.preventDefault(); navigate(1); }
  else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(k)) { e.preventDefault(); navigate(-1); }
  else if (k === ' ' || k === 'Enter') {
    e.preventDefault();
    if (run.phase === 'slide' && curTask().task.recording === 'per_token') toggleTokenRec(); else navigate(1);
  } else if (k === 'Escape') runnerMenu();
});

// ---------- SESIONES Y EXPORTACIÓN ----------
async function screenSessions() {
  const sessions = (await db.all('sessions')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const metas = await Promise.all(sessions.map((s) => db.fileMeta(s.id)));
  const statusLbl = { complete: 'completa', incomplete: 'incompleta', in_progress: 'interrumpida', consent: 'sin empezar' };
  setScreen(`<div class="page">${backBar('Sesiones', `<button class="btn" id="audit">Registro</button>`)}
    <div class="list">${sessions.map((s, i) => {
      const f = metas[i]; const size = f.reduce((a, x) => a + x.size, 0);
      return `<div class="item" data-id="${esc(s.id)}">
        <div class="item-main">
          <div class="item-t">${esc(s.participant)} · ${esc(s.session)} <span class="tag ${s.exportedAt ? 'ok' : 'warn'}">${s.exportedAt ? 'exportada' : 'sin exportar'}</span></div>
          <div class="item-s">${fmtDate(s.createdAt)} · ${esc(s.protocol.title)} · ${f.filter((x) => x.kind === 'wav').length} audios · ${fmtBytes(size)} · ${statusLbl[s.status] || s.status}</div>
          <div class="share-slot"></div>
        </div>
        <div class="item-actions">
          <button class="btn primary" data-exp>Exportar</button>
          <button class="btn ghost danger-t" data-del>Borrar</button>
        </div></div>`;
    }).join('') || '<p class="muted pad">Todavía no hay sesiones.</p>'}</div></div>`, 'scroll');
  bindBack();
  $$('.item[data-id]').forEach((el) => {
    const id = el.dataset.id;
    $('[data-exp]', el).addEventListener('click', () => prepareExport(id, $('.share-slot', el)));
    $('[data-del]', el).addEventListener('click', async () => {
      const s = sessions.find((x) => x.id === id);
      const ok = await modal({
        title: `Borrar ${s.participant} · ${s.session}`,
        body: s.exportedAt ? `<p>Exportada por última vez el ${fmtDate(s.exportedAt)}.</p>` : '<p><b>Esta sesión no se ha exportado nunca.</b> Si la borras, se perderán las grabaciones.</p>',
        ok: 'Borrar del dispositivo', danger: true,
        requireCheck: 'He comprobado que la exportación está guardada en un lugar seguro',
      });
      if (!ok) return;
      const n = await db.deleteSession(id);
      await db.audit('session_deleted', { sessionId: id, participant: s.participant, files: n, wasExported: !!s.exportedAt });
      toast('Sesión borrada');
      screenSessions();
    });
  });
  $('#audit').addEventListener('click', screenAudit);
}

async function screenAudit() {
  const rows = (await db.all('audit')).reverse();
  const lbl = { session_created: 'Sesión creada', session_completed: 'Sesión completada', session_ended_early: 'Sesión terminada antes de tiempo',
    protocol_updated: 'Protocolo actualizado', export_prepared: 'Exportación preparada', export_shared: 'Exportación compartida', export_downloaded: 'Exportación descargada',
    session_deleted: 'Sesión borrada', consent_declined: 'Consentimiento rechazado', protocol_imported: 'Protocolo importado', protocol_deleted: 'Protocolo borrado' };
  setScreen(`<div class="page">${backBar('Registro de actividad', `<button class="btn" id="a-csv">Exportar CSV</button>`)}
    <section class="panel"><table class="kv log">${rows.map((r) => `<tr><td class="muted">${fmtDate(r.time)}</td><td>${esc(lbl[r.action] || r.action)}</td><td>${esc(r.participant || r.protocol || '')}</td></tr>`).join('') || '<tr><td class="muted">Sin actividad.</td></tr>'}</table></section></div>`, 'scroll');
  bindBack();
  $('#a-csv').addEventListener('click', () => {
    const keys = ['time', 'action', 'sessionId', 'participant', 'protocol', 'files', 'wasExported', 'file'];
    const csv = [keys.join(',')].concat(rows.map((r) => keys.map((k) => csvCell(r[k])).join(','))).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `fieldrec_registro_${localDate()}.csv`);
  });
}

function csvCell(v) { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function trialsCSV(s) {
  const keys = ['participant', 'session', 'task', 'mode', 'order', 'item', 'rep', 'id', 'label', 'take', 'file', 'cut_file', 'onset_s', 'offset_s', 'duration_s', 'started_at', 'clipped', 'sample_rate', 'bit_depth'];
  return '﻿' + [keys.join(',')].concat(s.trials.map((t) => keys.map((k) => csvCell(k === 'participant' ? s.participant : k === 'session' ? s.session : t[k])).join(','))).join('\n') + '\n';
}

function sessionJSON(s, files) {
  const { protocolTexts, persisted, ...rest } = s;
  return { ...rest, files: files.map(({ blob, data, sessionId, ...f }) => f) };
}

const LEEME = (s) => `Exportación de Fieldrec ${APP_VERSION}
Participante: ${s.participant} · Sesión: ${s.session} · Fecha: ${s.createdAt}
Protocolo: ${s.protocol.title}

audio/        Archivos WAV (y TextGrid de Praat para las tareas de grabación continua)
trials.csv    Una fila por toma o por intervalo, con tiempos en segundos
session.json  Metadatos completos: ajustes de audio solicitados y obtenidos, consentimiento,
              orden de presentación (semilla ${s.seed}), incidencias e información del dispositivo
protocolo/    Copia de los archivos de texto del protocolo usados en la sesión
`;

async function prepareExport(sessionId, slot) {
  slot.innerHTML = '<div class="progress"><div></div></div><span class="muted small">Preparando…</span>';
  try {
    const s = await db.get('sessions', sessionId);
    const files = await db.filesForSession(sessionId);
    files.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
    const F = s.folderName;
    const entries = files.map((f) => ({ name: `${F}/audio/${f.name}`, data: f.data || f.blob }));
    entries.push({ name: `${F}/session.json`, data: JSON.stringify(sessionJSON(s, files), null, 2) });
    entries.push({ name: `${F}/trials.csv`, data: trialsCSV(s) });
    for (const [n, t] of Object.entries(s.protocolTexts || {})) entries.push({ name: `${F}/protocolo/${n.split('/').pop()}`, data: t });
    entries.push({ name: `${F}/LEEME.txt`, data: LEEME(s) });
    const bar = $('.progress div', slot);
    const zip = await makeZip(entries, (p) => { if (bar) bar.style.width = (p * 100).toFixed(0) + '%'; });
    const file = new File([zip], `${F}.zip`, { type: 'application/zip' });
    preparedExport = { sessionId, file };
    await db.audit('export_prepared', { sessionId, participant: s.participant, file: file.name });
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    slot.innerHTML = `<div class="row gap wrap">
      ${canShare ? '<button class="btn primary" data-share>Compartir / Guardar en Archivos</button>' : ''}
      <button class="btn" data-dl>Descargar ZIP</button>
      <span class="muted small">${esc(file.name)} · ${fmtBytes(file.size)}</span></div>`;
    const mark = async (how) => {
      s.exportedAt = new Date().toISOString();
      s.exports = (s.exports || []).concat([{ time: s.exportedAt, how }]);
      await db.put('sessions', s);
      await db.audit(how === 'share' ? 'export_shared' : 'export_downloaded', { sessionId, participant: s.participant, file: file.name });
    };
    const sh = $('[data-share]', slot);
    if (sh) sh.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: file.name }); await mark('share'); toast('Exportación compartida'); }
      catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir: ' + e.message, 'err'); }
    });
    $('[data-dl]', slot).addEventListener('click', async () => { downloadBlob(file, file.name); await mark('download'); });
  } catch (e) {
    slot.innerHTML = `<div class="notice warn">Error al exportar: ${esc(e.message)}</div>`;
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

// ---------- arranque ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('beforeunload', (e) => { if (run) { e.preventDefault(); e.returnValue = ''; } });
// Evita el zoom por doble toque y el gesto de pellizco durante la sesión
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.__fieldrec = { engine, get run() { return run; }, db };
screenHome();
