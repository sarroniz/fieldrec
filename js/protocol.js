// Markdown and CSV protocol reader, plus a minimal dependency-free Markdown renderer.
// Spanish keys (tarea, grabacion, …) are accepted as aliases of the English ones.

const KNOWN_KEYS = new Set([
  'title', 'titulo', 'author', 'autor', 'language', 'idioma', 'consent', 'consentimiento',
  'task', 'tarea', 'recording', 'grabacion', 'randomize', 'aleatorio', 'repetitions', 'repeticiones',
  'instructions', 'instrucciones', 'items', 'carrier', 'frase_marco', 'description', 'descripcion', 'label', 'etiqueta',
]);
const ALIASES = {
  titulo: 'title', autor: 'author', idioma: 'language', consentimiento: 'consent', tarea: 'task',
  grabacion: 'recording', aleatorio: 'randomize', repeticiones: 'repetitions',
  instrucciones: 'instructions', frase_marco: 'carrier', descripcion: 'description', etiqueta: 'label',
};

export const RECORDING_MODES = {
  continuous: 'Continuous', per_token: 'Per token', both: 'Continuous + cuts', none: 'No recording',
};

function normRecording(v) {
  const s = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['continuous', 'continua', 'continuo'].includes(s)) return 'continuous';
  if (['per_token', 'token', 'por_token', 'tokens', 'por_item', 'per_item'].includes(s)) return 'per_token';
  if (['both', 'ambas', 'ambos', 'continua_y_cortes'].includes(s)) return 'both';
  if (['none', 'no', 'ninguna', 'sin_grabacion'].includes(s)) return 'none';
  return null;
}
function normRandom(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['true', 'yes', 'si', 'sí', '1', 'blocked', 'bloques'].includes(s)) return 'blocked';
  if (['full', 'total', 'completo'].includes(s)) return 'full';
  return false;
}
function unquote(s) {
  s = String(s).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

export function slugify(s, max = 24) {
  const out = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ñ/gi, 'n')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return out.slice(0, max).replace(/_+$/, '');
}

// Plain text from Markdown (for TextGrid and CSV labels)
export function plainText(md) {
  return String(md || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => alt || `[${src.split('/').pop()}]`)
    .replace(/[#*_=`>]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- CSV ----------
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.split('\n')[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';

  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => slugify(h, 40));
  return nonEmpty.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
    return o;
  });
}

function rowText(row) {
  return row.text || row.texto || row.item || row.palabra || row.word || row.estimulo || row.stimulus || '';
}

function rowToSlide(row, carrier) {
  const text = rowText(row);
  const image = row.image || row.imagen || '';
  const c = row.carrier || row.frase_marco || carrier || '';
  let md = '';
  if (image) md += `![${text}](${image})\n\n`;
  if (text) {
    const shown = c && c.includes('{text}') ? c.replace('{text}', `**${text}**`) : text;
    md += `# ${shown}`;
  }
  return { id: slugify(row.id || text || image.replace(/\.[^.]+$/, '')), md: md.trim(), label: text || image };
}

// ---------- Markdown → protocol ----------
function parseConfigBlock(lines) {
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (!nonEmpty.length) return null;
  const obj = {};
  for (const l of nonEmpty) {
    const m = l.match(/^\s*([A-Za-z_áéíóúñ]+)\s*:\s*(.*)$/);
    if (!m) return null;
    const key = slugify(m[1], 30);
    if (!KNOWN_KEYS.has(key)) return null;
    obj[ALIASES[key] || key] = unquote(m[2]);
  }
  return obj;
}

function newTask(cfg, index) {
  return {
    name: slugify(cfg.task || `task${index + 1}`, 30) || `task${index + 1}`,
    title: cfg.label || cfg.task || `Task ${index + 1}`,
    recording: normRecording(cfg.recording) || 'per_token',
    randomize: normRandom(cfg.randomize),
    repetitions: Math.max(1, Math.min(20, parseInt(cfg.repetitions, 10) || 1)),
    instructions: cfg.instructions || '',
    carrier: cfg.carrier || '',
    items: cfg.items || '',
    slides: [],
  };
}

function applyTaskCfg(task, cfg) {
  if (cfg.recording && normRecording(cfg.recording)) task.recording = normRecording(cfg.recording);
  if ('randomize' in cfg) task.randomize = normRandom(cfg.randomize);
  if (cfg.repetitions) task.repetitions = Math.max(1, Math.min(20, parseInt(cfg.repetitions, 10) || 1));
  if (cfg.instructions) task.instructions = cfg.instructions;
  if (cfg.carrier) task.carrier = cfg.carrier;
  if (cfg.items) task.items = cfg.items;
  if (cfg.label) task.title = cfg.label;
}

/**
 * source = { mainName, readText(name) → Promise<string> }
 * Returns { title, consent, meta, tasks, warnings, missing }
 */
export async function parseProtocol(source) {
  const warnings = [];
  const main = source.mainName;
  const text = await source.readText(main);
  const protocol = { title: '', consent: '', meta: {}, tasks: [], warnings, missing: [] };

  if (/\.(csv|tsv|txt)$/i.test(main) && !/\.md$/i.test(main)) {
    const rows = parseCSV(text);
    protocol.title = main.replace(/\.[^.]+$/, '');
    let cur = null;
    for (const row of rows) {
      const tname = row.task || row.tarea || protocol.title;
      if (!cur || (row.task || row.tarea) && slugify(tname, 30) !== cur.name) {
        cur = newTask({ task: tname, recording: row.recording || row.grabacion, randomize: row.randomize || row.aleatorio,
          repetitions: row.repetitions || row.repeticiones, instructions: row.instructions || row.instrucciones,
          carrier: row.carrier || row.frase_marco }, protocol.tasks.length);
        protocol.tasks.push(cur);
      }
      const s = rowToSlide(row, cur.carrier);
      if (s.md) cur.slides.push(s);
    }
  } else {
    const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    const chunks = [];
    let buf = [];
    for (const l of lines) {
      if (/^\s*---\s*$/.test(l)) { chunks.push(buf); buf = []; } else buf.push(l);
    }
    chunks.push(buf);

    let cur = null;
    for (const chunk of chunks) {
      const cfg = parseConfigBlock(chunk);
      if (cfg) {
        if (cfg.task) {
          cur = newTask(cfg, protocol.tasks.length);
          protocol.tasks.push(cur);
        } else if (!cur && !protocol.tasks.length && !Object.keys(protocol.meta).length) {
          protocol.meta = cfg;
        } else if (cur) {
          applyTaskCfg(cur, cfg);
        } else {
          Object.assign(protocol.meta, cfg);
        }
        continue;
      }
      const md = chunk.join('\n').trim();
      if (!md) continue;
      if (!cur) { cur = newTask({}, protocol.tasks.length); protocol.tasks.push(cur); }
      const idm = md.match(/<!--\s*id\s*:\s*([^>]*?)\s*-->/i);
      const label = plainText(md);
      cur.slides.push({ id: slugify(idm ? idm[1] : label) || '', md, label });
    }
    protocol.title = protocol.meta.title || main.replace(/\.[^.]+$/, '');
  }

  // Items from a CSV referenced in the task header (items: words.csv)
  for (const t of protocol.tasks) {
    if (!t.items) continue;
    try {
      const rows = parseCSV(await source.readText(t.items));
      for (const row of rows) { const s = rowToSlide(row, t.carrier); if (s.md) t.slides.push(s); }
    } catch (e) {
      protocol.missing.push(t.items);
      warnings.push(`Missing “${t.items}”, the item list for task “${t.title}”.`);
    }
  }

  // Consent: literal text or a .md file
  const consent = protocol.meta.consent || '';
  if (/\.(md|txt)$/i.test(consent)) {
    try { protocol.consent = await source.readText(consent); }
    catch (e) { protocol.missing.push(consent); warnings.push(`Missing “${consent}”, the consent text.`); }
  } else protocol.consent = consent;

  // Default identifiers
  for (const t of protocol.tasks) {
    t.slides.forEach((s, i) => { if (!s.id) s.id = `s${String(i + 1).padStart(2, '0')}`; });
    if (!t.slides.length && !protocol.missing.includes(t.items)) warnings.push(`Task “${t.title}” has no slides.`);
  }
  protocol.tasks = protocol.tasks.filter((t) => t.slides.length);
  if (!protocol.tasks.length) warnings.push('The protocol contains no task with slides.');
  return protocol;
}

// Local images used by the protocol (to check they were imported, and to export it)
export function referencedImages(protocol) {
  const set = new Set();
  const scan = (md) => {
    for (const m of String(md || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (!/^(https?:|data:|blob:)/i.test(m[1])) set.add(m[1]);
    }
  };
  protocol.tasks.forEach((t) => t.slides.forEach((s) => scan(s.md)));
  scan(protocol.consent);
  return [...set];
}

// ---------- Reproducible randomization ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Presentation sequence for one task: [{ slide, rep, item }]
export function buildSequence(task, seed) {
  const rnd = mulberry32(seed);
  const items = task.slides.map((s, i) => ({ slide: s, item: i + 1 }));
  let seq = [];
  if (task.randomize === 'full') {
    for (let r = 1; r <= task.repetitions; r++) items.forEach((x) => seq.push({ ...x, rep: r }));
    seq = shuffle(seq, rnd);
  } else {
    for (let r = 1; r <= task.repetitions; r++) {
      const block = task.randomize ? shuffle(items, rnd) : items;
      block.forEach((x) => seq.push({ ...x, rep: r }));
    }
  }
  return seq;
}

// ---------- Minimal Markdown ----------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(s, resolve) {
  let h = esc(s);
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
    `<img src="${esc(resolve(src.replace(/&amp;/g, '&')))}" alt="${alt}" draggable="false">`);
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/==(.+?)==/g, '<mark>$1</mark>');
  h = h.replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
  h = h.replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>');
  return h;
}

export function renderMarkdown(md, resolve = (x) => x) {
  const lines = String(md || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null;
  const flushPara = () => {
    if (!para.length) return;
    let html = '';
    para.forEach((l, i) => {
      html += inline(l.text, resolve);
      if (i < para.length - 1) html += l.hard ? '<br>' : ' ';
    });
    out.push(`<p>${html}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i, resolve)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  for (const raw of lines) {
    const hard = / {2,}$|\\$/.test(raw);
    const l = raw.replace(/\s+$/, '');
    if (!l.trim()) { flushPara(); flushList(); continue; }
    let m;
    if ((m = l.match(/^\s*(#{1,3})\s+(.*)$/))) {
      flushPara(); flushList();
      out.push(`<h${m[1].length}>${inline(m[2].trim(), resolve)}</h${m[1].length}>`);
    } else if (/^\s*(!\[[^\]]*\]\([^)]+\)\s*)+$/.test(l)) {
      flushPara(); flushList();
      const imgs = [...l.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
      out.push(`<figure class="imgs n${imgs.length}">${imgs.map((x) =>
        `<img src="${esc(resolve(x[2]))}" alt="${esc(x[1])}" draggable="false">`).join('')}</figure>`);
    } else if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const type = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push(m[2]);
    } else {
      flushList();
      para.push({ text: l.trim().replace(/\\$/, ''), hard });
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}
