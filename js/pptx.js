// PowerPoint (.pptx) reader: turns each slide into positioned HTML that the app can show and scale.
// Supported: text boxes and placeholders (with master/layout inheritance), tables (incl. the default
// table style), pictures (crop, transparency), preset and custom shapes, connectors, groups and
// backgrounds. Not supported: charts, SmartArt, video playback, animations and transitions.
// Navigation buttons (shapes with a "next/previous slide" action) are hidden automatically.

import { openZip } from './unzip.js';

export const DESIGN_WIDTH = 1000; // slides are laid out at 1000 px wide and scaled to fit the screen

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const kids = (el, name) => (el ? [...el.children].filter((c) => !name || c.localName === name) : []);
const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) || null : null);
const dig = (el, ...names) => names.reduce((e, n) => kid(e, n), el);
const attr = (el, n) => (el ? el.getAttribute(n) : null);
const rId = (el, n = 'embed') => (el ? el.getAttributeNS(NS_R, n) || el.getAttribute('r:' + n) : null);
const num = (v, d = 0) => (v == null || v === '' ? d : Number(v));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (x) => Math.round(x * 100) / 100;

const relsPathFor = (part) => { const i = part.lastIndexOf('/'); return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`; };
function resolvePart(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}

// ---------- colors ----------
const COLOR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'];
const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', darkGray: 'A9A9A9', lightGray: 'D3D3D3' };
const hex2rgb = (h) => { h = String(h || '000000'); return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0, a: 1 }; };
function rgb2hsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  return { h, s, l };
}
function hsl2rgb({ h, s, l }) {
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return { r: Math.round(f(p, q, h + 1 / 3) * 255), g: Math.round(f(p, q, h) * 255), b: Math.round(f(p, q, h - 1 / 3) * 255) };
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function colorOf(container, ctx) {
  const c = container && [...container.children].find((x) => COLOR_TAGS.includes(x.localName));
  if (!c) return null;
  let col;
  switch (c.localName) {
    case 'srgbClr': col = hex2rgb(attr(c, 'val')); break;
    case 'sysClr': col = hex2rgb(attr(c, 'lastClr') || (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000')); break;
    case 'prstClr': col = hex2rgb(PRESET[attr(c, 'val')] || '000000'); break;
    case 'scrgbClr': {
      const g = (v) => Math.round(255 * Math.pow(clamp01(num(v) / 100000), 1 / 2.2));
      col = { r: g(attr(c, 'r')), g: g(attr(c, 'g')), b: g(attr(c, 'b')), a: 1 }; break;
    }
    case 'hslClr': col = { ...hsl2rgb({ h: num(attr(c, 'hue')) / 21600000, s: num(attr(c, 'sat')) / 100000, l: num(attr(c, 'lum')) / 100000 }), a: 1 }; break;
    case 'schemeClr': {
      const v = attr(c, 'val');
      if (v === 'phClr') { if (!ctx.phClr) return null; col = { ...ctx.phClr }; break; }
      const mapped = ctx.clrMap[v] || v;
      col = hex2rgb(ctx.theme.colors[mapped] || ctx.theme.colors[v] || '000000');
      break;
    }
    default: return null;
  }
  for (const m of c.children) {
    const v = num(attr(m, 'val')) / 100000;
    switch (m.localName) {
      case 'alpha': col.a = v; break;
      case 'alphaMod': col.a *= v; break;
      case 'lumMod': { const h = rgb2hsl(col); h.l = clamp01(h.l * v); Object.assign(col, hsl2rgb(h)); break; }
      case 'lumOff': { const h = rgb2hsl(col); h.l = clamp01(h.l + v); Object.assign(col, hsl2rgb(h)); break; }
      case 'satMod': { const h = rgb2hsl(col); h.s = clamp01(h.s * v); Object.assign(col, hsl2rgb(h)); break; }
      case 'tint': ['r', 'g', 'b'].forEach((k) => { col[k] = Math.round(col[k] * v + 255 * (1 - v)); }); break;
      case 'shade': ['r', 'g', 'b'].forEach((k) => { col[k] = Math.round(col[k] * v); }); break;
      default: break;
    }
  }
  return col;
}
const css = (c) => (c ? (c.a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${r2(c.a)})`) : 'transparent');

// ---------- fonts ----------
function fontStack(name, ctx) {
  if (!name) return null;
  if (name.startsWith('+mj')) name = ctx.theme.fonts.major;
  else if (name.startsWith('+mn')) name = ctx.theme.fonts.minor;
  if (!name) return null;
  const n = name.toLowerCase();
  const fb = /times|cambria|georgia|garamond|book|serif|palatino|constantia/.test(n) && !/sans/.test(n) ? '"Times New Roman", Georgia, serif'
    : /courier|consolas|mono|code/.test(n) ? 'Menlo, Courier, monospace'
      : '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
  return `"${name.replace(/"/g, '')}", ${fb}`;
}

// ---------- text style inheritance ----------
function parseRPr(el, ctx) {
  if (!el) return {};
  const o = {};
  const sz = attr(el, 'sz'); if (sz) o.sz = num(sz);
  if (attr(el, 'b') != null) o.b = attr(el, 'b') === '1' || attr(el, 'b') === 'true';
  if (attr(el, 'i') != null) o.i = attr(el, 'i') === '1' || attr(el, 'i') === 'true';
  if (attr(el, 'u') != null) o.u = attr(el, 'u') !== 'none';
  if (attr(el, 'strike') != null) o.strike = attr(el, 'strike') !== 'noStrike';
  if (attr(el, 'baseline') != null) o.baseline = num(attr(el, 'baseline'));
  if (attr(el, 'cap') != null) o.cap = attr(el, 'cap');
  const fill = kid(el, 'solidFill'); if (fill) o.color = colorOf(fill, ctx);
  if (kid(el, 'noFill')) o.color = { r: 0, g: 0, b: 0, a: 0 };
  const latin = kid(el, 'latin'); if (latin && attr(latin, 'typeface')) o.font = attr(latin, 'typeface');
  const hl = kid(el, 'highlight'); if (hl) o.highlight = colorOf(hl, ctx);
  return o;
}
function parsePPr(el, ctx) {
  if (!el) return {};
  const o = {};
  for (const a of ['algn', 'marL', 'indent', 'lvl']) if (attr(el, a) != null) o[a] = a === 'algn' ? attr(el, a) : num(attr(el, a));
  const sp = (name) => { const s = kid(el, name); if (!s) return null; const pct = kid(s, 'spcPct'), pts = kid(s, 'spcPts'); return pct ? { pct: num(attr(pct, 'val')) / 100000 } : pts ? { pts: num(attr(pts, 'val')) / 100 } : null; };
  const ln = sp('lnSpc'); if (ln) o.lnSpc = ln;
  const bef = sp('spcBef'); if (bef) o.spcBef = bef;
  const aft = sp('spcAft'); if (aft) o.spcAft = aft;
  if (kid(el, 'buNone')) { o.bu = null; o.buSet = true; }
  const bc = kid(el, 'buChar'); if (bc) { o.bu = { char: attr(bc, 'char') }; o.buSet = true; }
  const ba = kid(el, 'buAutoNum'); if (ba) { o.bu = { auto: attr(ba, 'type') || 'arabicPeriod', start: num(attr(ba, 'startAt'), 1) }; o.buSet = true; }
  const bclr = kid(el, 'buClr'); if (bclr) o.buColor = colorOf(bclr, ctx);
  const bsz = kid(el, 'buSzPct'); if (bsz) o.buSz = num(attr(bsz, 'val')) / 100000;
  const bf = kid(el, 'buFont'); if (bf) o.buFont = attr(bf, 'typeface');
  return o;
}
// lstStyle → 9 levels of { para, run }
function parseLstStyle(el, ctx) {
  const out = [];
  if (!el) return out;
  const def = kid(el, 'defPPr');
  for (let i = 0; i < 9; i++) {
    const l = kid(el, `lvl${i + 1}pPr`) || (i === 0 ? def : null);
    if (l) out[i] = { para: parsePPr(l, ctx), run: parseRPr(kid(l, 'defRPr'), ctx) };
  }
  return out;
}
function mergeLevels(...layers) {
  const out = [];
  for (let i = 0; i < 9; i++) {
    let para = {}, run = {};
    for (const L of layers) {
      if (L && L[i]) { para = { ...para, ...L[i].para }; run = { ...run, ...L[i].run }; }
    }
    out[i] = { para, run };
  }
  return out;
}

// ---------- geometry ----------
function presetPath(prst, w, h, av) {
  const ss = Math.min(w, h);
  const adj = (name, d) => (av[name] != null ? av[name] : d);
  const P = (pts) => 'M' + pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' L') + ' Z';
  switch (prst) {
    case 'rightArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000); const y1 = h / 2 - (h * a1) / 200000, y2 = h / 2 + (h * a1) / 200000, x = w - (ss * a2) / 100000; return P([[0, y1], [x, y1], [x, 0], [w, h / 2], [x, h], [x, y2], [0, y2]]); }
    case 'leftArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000); const y1 = h / 2 - (h * a1) / 200000, y2 = h / 2 + (h * a1) / 200000, x = (ss * a2) / 100000; return P([[w, y1], [x, y1], [x, 0], [0, h / 2], [x, h], [x, y2], [w, y2]]); }
    case 'upArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000); const x1 = w / 2 - (w * a1) / 200000, x2 = w / 2 + (w * a1) / 200000, y = (ss * a2) / 100000; return P([[x1, h], [x1, y], [0, y], [w / 2, 0], [w, y], [x2, y], [x2, h]]); }
    case 'downArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000); const x1 = w / 2 - (w * a1) / 200000, x2 = w / 2 + (w * a1) / 200000, y = h - (ss * a2) / 100000; return P([[x1, 0], [x1, y], [0, y], [w / 2, h], [w, y], [x2, y], [x2, 0]]); }
    case 'leftRightArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000); const y1 = h / 2 - (h * a1) / 200000, y2 = h / 2 + (h * a1) / 200000, x = (ss * a2) / 100000; return P([[0, h / 2], [x, 0], [x, y1], [w - x, y1], [w - x, 0], [w, h / 2], [w - x, h], [w - x, y2], [x, y2], [x, h]]); }
    case 'triangle': { const x = (w * adj('adj', 50000)) / 100000; return P([[x, 0], [w, h], [0, h]]); }
    case 'rtTriangle': return P([[0, 0], [w, h], [0, h]]);
    case 'diamond': case 'flowChartDecision': return P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': case 'flowChartInputOutput': { const o = (ss * adj('adj', 25000)) / 100000; return P([[o, 0], [w, 0], [w - o, h], [0, h]]); }
    case 'trapezoid': { const o = (ss * adj('adj', 25000)) / 100000; return P([[0, h], [o, 0], [w - o, 0], [w, h]]); }
    case 'homePlate': case 'pentagon': { const x = w - (ss * adj('adj', 50000)) / 100000; return P([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]); }
    case 'chevron': { const x = (ss * adj('adj', 50000)) / 100000; return P([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]); }
    case 'hexagon': { const x = (ss * adj('adj', 25000)) / 100000; return P([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]); }
    case 'octagon': { const x = (ss * adj('adj', 29289)) / 100000; return P([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]); }
    case 'plus': case 'mathPlus': { const x = (ss * adj('adj', 25000)) / 100000; return P([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]].map((p, i) => p)); }
    case 'star5': {
      const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.38 : 0.5; const a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([w / 2 + Math.cos(a) * w * r, h / 2 + Math.sin(a) * h * r * 1.05]); }
      return P(pts);
    }
    case 'line': case 'straightConnector1': return `M0,0 L${r2(w)},${r2(h)}`;
    default: return null;
  }
}
const CSS_SHAPES = { rect: 0, roundRect: 1, ellipse: 2, flowChartProcess: 0, flowChartAlternateProcess: 1, flowChartTerminator: 3, snipRoundRect: 1, round2SameRect: 1, wedgeRectCallout: 0, wedgeRoundRectCallout: 1, wedgeEllipseCallout: 2, flowChartConnector: 2, cloud: 2, cloudCallout: 2, frame: 0, bevel: 0, plaque: 1, can: 1, cube: 0 };

function custPath(spPr, w, h) {
  const lst = dig(spPr, 'custGeom', 'pathLst');
  if (!lst) return null;
  let d = '';
  for (const p of kids(lst, 'path')) {
    const pw = num(attr(p, 'w'), 0) || 1, ph = num(attr(p, 'h'), 0) || 1;
    const sx = attr(p, 'w') ? w / pw : 1, sy = attr(p, 'h') ? h / ph : 1;
    const pt = (el) => `${r2(num(attr(el, 'x')) * sx)},${r2(num(attr(el, 'y')) * sy)}`;
    for (const c of p.children) {
      const pts = kids(c, 'pt');
      if (c.localName === 'moveTo') d += `M${pt(pts[0])} `;
      else if (c.localName === 'lnTo') d += `L${pt(pts[0])} `;
      else if (c.localName === 'cubicBezTo') d += `C${pts.map(pt).join(' ')} `;
      else if (c.localName === 'quadBezTo') d += `Q${pts.map(pt).join(' ')} `;
      else if (c.localName === 'close') d += 'Z ';
    }
  }
  return d || null;
}

// ---------- main entry ----------
/**
 * readPptx(file, { onProgress }) → {
 *   width, height,                // design size in px (width = 1000)
 *   slides: [{ kind:'pptx', index, id, label, title, notes, html, w, h, hidden, section, navHidden }],
 *   media: Map(originalPartPath → { blob, maxDisplayPx }),
 *   warnings: [string]
 * }
 * In each slide's html, images are <img data-media="ppt/media/imageN.ext">; the caller decides their final paths.
 */
export async function readPptx(file, { onProgress } = {}) {
  const report = (msg, f) => { if (onProgress) onProgress(msg, f); };
  report('Opening the presentation…', 0);
  const zip = await openZip(file);
  const parser = new DOMParser();
  const xmlCache = new Map(), relsCache = new Map();
  const loadXml = async (name) => {
    if (xmlCache.has(name)) return xmlCache.get(name);
    const e = zip.get(name);
    const doc = e ? parser.parseFromString(await e.text(), 'application/xml') : null;
    xmlCache.set(name, doc);
    return doc;
  };
  const loadRels = async (part) => {
    if (relsCache.has(part)) return relsCache.get(part);
    const doc = await loadXml(relsPathFor(part));
    const map = {};
    if (doc) for (const r of doc.documentElement.children) {
      if (attr(r, 'TargetMode') === 'External') { map[attr(r, 'Id')] = { type: attr(r, 'Type'), external: attr(r, 'Target') }; continue; }
      map[attr(r, 'Id')] = { type: attr(r, 'Type') || '', target: resolvePart(part, attr(r, 'Target')) };
    }
    relsCache.set(part, map);
    return map;
  };
  const byType = (rels, t) => Object.values(rels).find((r) => r.type.endsWith('/' + t));

  const pres = await loadXml('ppt/presentation.xml');
  if (!pres) throw new Error('This file is not a PowerPoint presentation (.pptx)');
  const presEl = pres.documentElement;
  const sz = kid(presEl, 'sldSz');
  const cx = num(attr(sz, 'cx'), 12192000), cy = num(attr(sz, 'cy'), 6858000);
  const k = DESIGN_WIDTH / cx;
  const H = r2(cy * k);
  const presRels = await loadRels('ppt/presentation.xml');
  const sldIds = kids(kid(presEl, 'sldIdLst'), 'sldId').map((s) => ({ id: attr(s, 'id'), part: presRels[rId(s, 'id')] && presRels[rId(s, 'id')].target })).filter((s) => s.part);

  // sections (PowerPoint 2010+)
  const sectionOf = {};
  for (const sec of presEl.getElementsByTagNameNS('*', 'section')) {
    const name = attr(sec, 'name');
    for (const s of sec.getElementsByTagNameNS('*', 'sldId')) sectionOf[attr(s, 'id')] = name;
  }

  // theme (via the first master)
  const themeCache = new Map();
  const loadTheme = async (part) => {
    if (themeCache.has(part)) return themeCache.get(part);
    const doc = part && await loadXml(part);
    const t = { colors: {}, fonts: { major: 'Calibri Light', minor: 'Calibri' }, lnWidths: [9525, 12700, 19050] };
    if (doc) {
      const cs = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
      if (cs) for (const c of cs.children) {
        const v = c.firstElementChild;
        if (v) t.colors[c.localName] = v.localName === 'sysClr' ? (attr(v, 'lastClr') || (attr(v, 'val') === 'window' ? 'FFFFFF' : '000000')) : attr(v, 'val');
      }
      const fs = doc.getElementsByTagNameNS('*', 'fontScheme')[0];
      if (fs) {
        const mj = dig(fs, 'majorFont', 'latin'), mn = dig(fs, 'minorFont', 'latin');
        if (mj) t.fonts.major = attr(mj, 'typeface'); if (mn) t.fonts.minor = attr(mn, 'typeface');
      }
      const ls = doc.getElementsByTagNameNS('*', 'lnStyleLst')[0];
      if (ls) t.lnWidths = kids(ls, 'ln').map((l) => num(attr(l, 'w'), 9525));
    }
    themeCache.set(part, t);
    return t;
  };

  const presDefaults = kid(presEl, 'defaultTextStyle');

  const mediaUse = new Map(); // part → max display px
  const useMedia = (part, wpx, hpx) => { const m = Math.max(wpx, hpx); mediaUse.set(part, Math.max(mediaUse.get(part) || 0, m)); };
  const warnings = new Set();

  const slides = [];
  const footers = [];
  for (let si = 0; si < sldIds.length; si++) {
    report(`Reading slide ${si + 1} of ${sldIds.length}…`, (si / sldIds.length) * 0.5);
    const part = sldIds[si].part;
    const sDoc = await loadXml(part);
    if (!sDoc) continue;
    const sRels = await loadRels(part);
    const layoutPart = byType(sRels, 'slideLayout') && byType(sRels, 'slideLayout').target;
    const lDoc = layoutPart ? await loadXml(layoutPart) : null;
    const lRels = layoutPart ? await loadRels(layoutPart) : {};
    const masterPart = byType(lRels, 'slideMaster') && byType(lRels, 'slideMaster').target;
    const mDoc = masterPart ? await loadXml(masterPart) : null;
    const mRels = masterPart ? await loadRels(masterPart) : {};
    const theme = await loadTheme(byType(mRels, 'theme') && byType(mRels, 'theme').target);
    const clrMapEl = mDoc && kid(mDoc.documentElement, 'clrMap');
    const clrMap = {};
    if (clrMapEl) for (const a of clrMapEl.attributes) clrMap[a.name] = a.value;
    const ovr = dig(sDoc.documentElement, 'clrMapOvr', 'overrideClrMapping');
    if (ovr) for (const a of ovr.attributes) clrMap[a.name] = a.value;

    const ctx = { theme, clrMap, k, slideNum: si + 1, phClr: null, navHidden: 0, footer: '', titleText: '', texts: [] };
    ctx.tx1 = colorOf(fakeScheme('tx1'), ctx);
    const phList = (doc) => {
      const out = [];
      const tree = doc && dig(doc.documentElement, 'cSld', 'spTree');
      if (tree) for (const sp of tree.getElementsByTagNameNS('*', 'ph')) {
        const holder = sp.closest ? sp.closest('sp, pic, graphicFrame') : null;
        let el = sp; while (el && !['sp', 'pic', 'graphicFrame'].includes(el.localName)) el = el.parentElement;
        out.push({ type: attr(sp, 'type') || 'body', idx: attr(sp, 'idx'), el: el || holder });
      }
      return out;
    };
    ctx.layoutPhs = phList(lDoc);
    ctx.masterPhs = phList(mDoc);
    const norm = (t) => (t === 'ctrTitle' ? 'title' : ['subTitle', 'obj', 'body'].includes(t) ? 'body' : t);
    ctx.findPh = (list, info, byIdx) => {
      if (byIdx && info.idx != null) { const m = list.find((p) => p.idx === info.idx); if (m) return m; }
      return list.find((p) => norm(p.type) === norm(info.type)) || null;
    };
    const masterTx = mDoc && kid(mDoc.documentElement, 'txStyles');
    ctx.styles = {
      pres: parseLstStyle(presDefaults, ctx),
      title: parseLstStyle(kid(masterTx, 'titleStyle'), ctx),
      body: parseLstStyle(kid(masterTx, 'bodyStyle'), ctx),
      other: parseLstStyle(kid(masterTx, 'otherStyle'), ctx),
    };

    // media lookup per part
    const relsByPart = { [part]: sRels, [layoutPart]: lRels, [masterPart]: mRels };
    ctx.mediaFor = (partName, id) => { const r = relsByPart[partName] && relsByPart[partName][id]; return r && r.target ? r.target : null; };

    // background
    const bgHtml = (() => {
      for (const [doc, p] of [[sDoc, part], [lDoc, layoutPart], [mDoc, masterPart]]) {
        const bg = doc && dig(doc.documentElement, 'cSld', 'bg');
        if (!bg) continue;
        const bgPr = kid(bg, 'bgPr');
        if (bgPr) {
          const solid = kid(bgPr, 'solidFill'), grad = kid(bgPr, 'gradFill'), blip = kid(bgPr, 'blipFill');
          if (solid) return `background:${css(colorOf(solid, ctx))}`;
          if (grad) return `background:${gradientCss(grad, ctx)}`;
          if (blip) {
            const target = ctx.mediaFor(p, rId(kid(blip, 'blip')));
            if (target) { useMedia(target, DESIGN_WIDTH, H); return { img: target }; }
          }
          return 'background:#fff';
        }
        const ref = kid(bg, 'bgRef');
        if (ref) { const c = colorOf(ref, ctx); return `background:${c ? css(c) : '#fff'}`; }
      }
      return 'background:#fff';
    })();


    function renderTree(tree, partName, c, opts, xf = { ox: 0, oy: 0, sx: 1, sy: 1 }) {
      if (!tree) return '';
      let html = '';
      for (const el of tree.children) html += renderNode(el, partName, c, opts, xf);
      return html;
    }

    function renderNode(el, partName, c, opts, xf) {
      switch (el.localName) {
        case 'sp': return renderSp(el, partName, c, opts, xf);
        case 'pic': return opts.decorOnly && dig(el, 'nvPicPr', 'nvPr', 'ph') ? '' : renderPic(el, partName, c, xf);
        case 'cxnSp': return renderCxn(el, c, xf);
        case 'grpSp': return renderGrp(el, partName, c, opts, xf);
        case 'graphicFrame': return opts.decorOnly && dig(el, 'nvGraphicFramePr', 'nvPr', 'ph') ? '' : renderFrame(el, partName, c, xf);
        case 'AlternateContent': {
          const fb = kid(el, 'Fallback'), ch = kid(el, 'Choice');
          const src = fb && fb.children.length ? fb : ch;
          return src ? [...src.children].map((x) => renderNode(x, partName, c, opts, xf)).join('') : '';
        }
        default: return '';
      }
    }

    function box(xfrm, xf) {
      const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
      const x = num(attr(off, 'x')), y = num(attr(off, 'y')), w = num(attr(ext, 'cx')), h = num(attr(ext, 'cy'));
      return {
        x: (xf.ox + x * xf.sx) * k, y: (xf.oy + y * xf.sy) * k, w: w * xf.sx * k, h: h * xf.sy * k,
        rot: num(attr(xfrm, 'rot')) / 60000, flipH: attr(xfrm, 'flipH') === '1', flipV: attr(xfrm, 'flipV') === '1',
      };
    }
    const posStyle = (b) => {
      let s = `left:${r2(b.x)}px;top:${r2(b.y)}px;width:${r2(Math.max(b.w, 0.5))}px;height:${r2(Math.max(b.h, 0.5))}px;`;
      const t = []; if (b.rot) t.push(`rotate(${r2(b.rot)}deg)`); if (b.flipH) t.push('scaleX(-1)'); if (b.flipV) t.push('scaleY(-1)');
      if (t.length) s += `transform:${t.join(' ')};`;
      return s;
    };
    const isNav = (cNvPr) => {
      const hl = kid(cNvPr, 'hlinkClick');
      return !!hl && /hlinkshowjump|hlinksldjump/.test(attr(hl, 'action') || '') && /jump=(next|previous|first|last)slide|hlinksldjump/.test(attr(hl, 'action') || '');
    };

    function lineOf(spPr, style, c) {
      const ln = kid(spPr, 'ln');
      if (ln) {
        if (kid(ln, 'noFill')) return null;
        const fill = kid(ln, 'solidFill') || kid(ln, 'gradFill');
        let color = fill ? (fill.localName === 'solidFill' ? colorOf(fill, c) : colorOf(kid(kid(fill, 'gsLst'), 'gs'), c)) : null;
        if (!color && style) { const ref = kid(style, 'lnRef'); if (ref && num(attr(ref, 'idx')) > 0) color = colorOf(ref, c); }
        if (!color) return null;
        const w = num(attr(ln, 'w'), style ? (c.theme.lnWidths[Math.max(0, num(attr(kid(style, 'lnRef'), 'idx'), 1) - 1)] || 12700) : 12700);
        const dash = attr(kid(ln, 'prstDash'), 'val');
        return { color, w: Math.max(0.6, w * k), dash: dash && dash !== 'solid' ? dash : null, head: attr(kid(ln, 'headEnd'), 'type'), tail: attr(kid(ln, 'tailEnd'), 'type') };
      }
      if (style) {
        const ref = kid(style, 'lnRef'); const idx = num(attr(ref, 'idx'));
        if (ref && idx > 0) { const color = colorOf(ref, c); if (color) return { color, w: Math.max(0.6, (c.theme.lnWidths[idx - 1] || 12700) * k) }; }
      }
      return null;
    }
    function fillOf(spPr, style, c, partName) {
      if (!spPr) spPr = null;
      if (kid(spPr, 'noFill')) return null;
      const solid = kid(spPr, 'solidFill'); if (solid) return { css: css(colorOf(solid, c)) };
      const grad = kid(spPr, 'gradFill'); if (grad) return { css: gradientCss(grad, c) };
      const patt = kid(spPr, 'pattFill'); if (patt) return { css: css(colorOf(kid(patt, 'fgClr'), c)) };
      const blip = kid(spPr, 'blipFill');
      if (blip) { const t = c.mediaFor(partName, rId(kid(blip, 'blip'))); if (t) return { img: t }; }
      if (kid(spPr, 'grpFill')) return null;
      if (style) { const ref = kid(style, 'fillRef'); if (ref && num(attr(ref, 'idx')) > 0) { const col = colorOf(ref, c); if (col) return { css: css(col) }; } }
      return null;
    }

    function textStylesFor(sp, phInfo, c) {
      const cat = !phInfo ? 'other' : ['title', 'ctrTitle'].includes(phInfo.type) ? 'title' : ['body', 'subTitle', 'obj'].includes(phInfo.type) ? 'body' : 'other';
      const layers = [c.styles.pres, c.styles[cat]];
      if (phInfo) {
        const mp = c.findPh(c.masterPhs, phInfo, false), lp = c.findPh(c.layoutPhs, phInfo, true);
        if (mp) layers.push(parseLstStyle(dig(mp.el, 'txBody', 'lstStyle'), c));
        if (lp) layers.push(parseLstStyle(dig(lp.el, 'txBody', 'lstStyle'), c));
      }
      const style = kid(sp, 'style');
      const fontRef = style && kid(style, 'fontRef');
      if (fontRef) {
        const col = colorOf(fontRef, c);
        const f = attr(fontRef, 'idx') === 'major' ? '+mj-lt' : attr(fontRef, 'idx') === 'minor' ? '+mn-lt' : null;
        const run = {}; if (col) run.color = col; if (f) run.font = f;
        layers.push(Array.from({ length: 9 }, () => ({ para: {}, run })));
      }
      layers.push(parseLstStyle(dig(sp, 'txBody', 'lstStyle'), c));
      return mergeLevels(...layers);
    }
    function bodyPrFor(sp, phInfo, c) {
      const chain = [];
      if (phInfo) {
        const mp = c.findPh(c.masterPhs, phInfo, false), lp = c.findPh(c.layoutPhs, phInfo, true);
        if (mp) chain.push(dig(mp.el, 'txBody', 'bodyPr'));
        if (lp) chain.push(dig(lp.el, 'txBody', 'bodyPr'));
      }
      chain.push(dig(sp, 'txBody', 'bodyPr'));
      const o = {};
      for (const b of chain) {
        if (!b) continue;
        for (const a of b.attributes) o[a.name] = a.value;
        const na = kid(b, 'normAutofit');
        if (na) { o.fontScale = num(attr(na, 'fontScale'), 100000); o.lnRed = num(attr(na, 'lnSpcReduction'), 0); }
        if (kid(b, 'spAutoFit')) o.spAutoFit = true;
        if (kid(b, 'noAutofit')) { delete o.fontScale; delete o.lnRed; }
      }
      return o;
    }

    function renderText(txBody, styles, bp, c) {
      if (!txBody) return '';
      const ins = { l: num(bp.lIns, 91440) * k, t: num(bp.tIns, 45720) * k, r: num(bp.rIns, 91440) * k, b: num(bp.bIns, 45720) * k };
      const fscale = (bp.fontScale || 100000) / 100000;
      const lred = (bp.lnRed || 0) / 100000;
      const anchor = bp.anchor || 't';
      const nowrap = bp.wrap === 'none';
      const ptPx = (pt) => pt * 12700 * k;
      let html = '', autoNum = {};
      let any = false;
      for (const p of kids(txBody, 'p')) {
        const pPrEl = kid(p, 'pPr');
        const lvl = num(attr(pPrEl, 'lvl'), 0);
        const st = styles[lvl] || { para: {}, run: {} };
        const para = { ...st.para, ...parsePPr(pPrEl, c) };
        const endRun = { ...st.run, ...parseRPr(kid(p, 'endParaRPr'), c) };
        const baseSize = (endRun.sz || st.run.sz || 1800) / 100;
        let runsHtml = '', text = '', firstRun = null;
        for (const r of p.children) {
          if (r.localName === 'r' || r.localName === 'fld') {
            let t = (kid(r, 't') && kid(r, 't').textContent) || '';
            if (r.localName === 'fld' && /slidenum/i.test(attr(r, 'type') || '')) t = String(c.slideNum);
            const rp = { ...st.run, ...parseRPr(kid(r, 'rPr'), c) };
            if (!firstRun) firstRun = rp;
            text += t;
            runsHtml += runSpan(t, rp, c, fscale);
          } else if (r.localName === 'br') {
            runsHtml += '<br>';
            text += '\n';
          }
        }
        if (text.trim()) { any = true; c.texts.push(text.trim()); }
        const sizePt = ((firstRun && firstRun.sz) || (endRun.sz) || 1800) / 100 * fscale;
        let lh = 1.2;
        if (para.lnSpc && para.lnSpc.pct != null) lh = 1.2 * para.lnSpc.pct * (1 - lred);
        const lhCss = para.lnSpc && para.lnSpc.pts != null ? `${r2(ptPx(para.lnSpc.pts))}px` : r2(lh);
        const spc = (s) => (!s ? 0 : s.pts != null ? ptPx(s.pts) : ptPx(sizePt) * 1.2 * s.pct);
        const marL = num(para.marL) * k, indent = num(para.indent) * k;
        const algn = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[para.algn || 'l'] || 'left';
        let bullet = '';
        if (para.bu && text.trim()) {
          let b = '';
          if (para.bu.char) b = esc(para.bu.char);
          else if (para.bu.auto) { const key = lvl; autoNum[key] = (autoNum[key] || para.bu.start - 1) + 1; b = autoLabel(para.bu.auto, autoNum[key]); }
          const bcol = para.buColor ? `color:${css(para.buColor)};` : (firstRun && firstRun.color ? `color:${css(firstRun.color)};` : '');
          const bsize = para.buSz ? `font-size:${r2(para.buSz * 100)}%;` : '';
          const w = indent < 0 ? -indent : ptPx(sizePt) * 0.9;
          bullet = `<span class="bu" style="display:inline-block;text-indent:0;width:${r2(w)}px;${bcol}${bsize}${runCss(firstRun || endRun, c, fscale, true)}">${b}</span>`;
        } else if (!para.bu) { autoNum[lvl] = 0; }
        // hanging indent: the first line starts at marL + indent (where the bullet goes), the rest at marL
        const padL = marL;
        const ti = indent;
        const emptyLine = !text.trim() && !runsHtml.includes('<br>') ? `<span style="font-size:${r2(ptPx(baseSize * fscale))}px">&#8203;</span>` : '';
        html += `<p style="font-size:${r2(ptPx(sizePt))}px;text-align:${algn};padding-left:${r2(Math.max(0, padL))}px;text-indent:${r2(ti)}px;line-height:${lhCss};margin:${r2(spc(para.spcBef))}px 0 ${r2(spc(para.spcAft))}px">${bullet}${runsHtml}${emptyLine}</p>`;
      }
      if (!any) return '';
      const justify = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
      return `<div class="tx" style="padding:${r2(ins.t)}px ${r2(ins.r)}px ${r2(ins.b)}px ${r2(ins.l)}px;justify-content:${justify};${nowrap ? 'white-space:nowrap;' : ''}">${html}</div>`;
    }
    function runCss(rp, c, fscale, bulletOnly) {
      let s = '';
      const pt = ((rp && rp.sz) || 1800) / 100 * fscale;
      s += `font-size:${r2(pt * 12700 * k)}px;`;
      if (bulletOnly) return s;
      const f = fontStack(rp.font || '+mn-lt', c); if (f) s += `font-family:${f.replace(/"/g, "'")};`;
      if (rp.b) s += 'font-weight:700;';
      if (rp.i) s += 'font-style:italic;';
      const dec = [rp.u ? 'underline' : '', rp.strike ? 'line-through' : ''].filter(Boolean).join(' ');
      if (dec) s += `text-decoration:${dec};`;
      s += `color:${css(rp.color || c.tx1)};`;
      if (rp.baseline) s += `vertical-align:${rp.baseline > 0 ? 'super' : 'sub'};font-size:${r2(pt * 12700 * k * 0.7)}px;`;
      if (rp.cap === 'all') s += 'text-transform:uppercase;';
      if (rp.cap === 'small') s += 'font-variant:small-caps;';
      if (rp.highlight) s += `background:${css(rp.highlight)};`;
      return s;
    }
    function runSpan(t, rp, c, fscale) {
      if (!t) return '';
      return `<span style="${runCss(rp, c, fscale)}">${esc(t).replace(/\t/g, '&emsp;')}</span>`;
    }

    function renderSp(sp, partName, c, opts, xf) {
      const nv = kid(sp, 'nvSpPr'), cNvPr = kid(nv, 'cNvPr');
      if (attr(cNvPr, 'hidden') === '1') return '';
      const phEl = dig(nv, 'nvPr', 'ph');
      if (opts.decorOnly && phEl) return ''; // layout/master placeholders are templates, not content
      if (isNav(cNvPr)) { c.navHidden++; return ''; }
      const phInfo = phEl ? { type: attr(phEl, 'type') || 'body', idx: attr(phEl, 'idx') } : null;
      const spPr = kid(sp, 'spPr');
      const lp = phInfo ? c.findPh(c.layoutPhs, phInfo, true) : null;
      const mp = phInfo ? c.findPh(c.masterPhs, phInfo, false) : null;
      const xfrm = kid(spPr, 'xfrm') || kid(kid(lp && lp.el, 'spPr'), 'xfrm') || kid(kid(mp && mp.el, 'spPr'), 'xfrm');
      if (!xfrm) return '';
      const b = box(xfrm, xf);
      const style = kid(sp, 'style');
      const txBody = kid(sp, 'txBody');
      const hasText = !!(txBody && txBody.textContent.trim());
      if (phInfo && ['dt', 'sldNum'].includes(phInfo.type) && !hasText) return '';
      if (phInfo && phInfo.type === 'ftr') { c.footer = txBody ? txBody.textContent.trim() : ''; }
      // fill and line: own spPr, then (for placeholders) layout and master spPr
      const fillSrc = [spPr, lp && kid(lp.el, 'spPr'), mp && kid(mp.el, 'spPr')].find((s) => s && (kid(s, 'solidFill') || kid(s, 'gradFill') || kid(s, 'noFill') || kid(s, 'blipFill') || kid(s, 'pattFill')));
      const lnSrc = [spPr, lp && kid(lp.el, 'spPr'), mp && kid(mp.el, 'spPr')].find((s) => s && kid(s, 'ln'));
      const fill = fillOf(fillSrc || spPr, style, c, partName);
      const line = lineOf(lnSrc || spPr, style, c);
      if (phInfo && !hasText && !fill && !line) return '';
      const geomEl = kid(spPr, 'prstGeom') || kid(kid(lp && lp.el, 'spPr'), 'prstGeom');
      const prst = geomEl ? attr(geomEl, 'prst') : kid(spPr, 'custGeom') ? 'cust' : 'rect';
      const av = {}; for (const g of kids(kid(geomEl, 'avLst'), 'gd')) { const m = /val\s+(-?\d+)/.exec(attr(g, 'fmla') || ''); if (m) av[attr(g, 'name')] = Number(m[1]); }

      let shapeHtml = '';
      if (fill || line) {
        if (prst in CSS_SHAPES) {
          const kind = CSS_SHAPES[prst];
          const lw = line ? line.w : 0;
          const radius = kind === 2 ? '50%' : kind === 3 ? `${r2(Math.min(b.w, b.h) / 2)}px` : kind === 1 ? `${r2((Math.min(b.w, b.h) * (av.adj != null ? av.adj : 16667)) / 100000)}px` : '0';
          let bg = '';
          if (fill && fill.css) bg = `background:${fill.css};`;
          if (fill && fill.img) { useMedia(fill.img, b.w, b.h); }
          const border = line ? `border:${r2(lw)}px ${line.dash ? (/dot/i.test(line.dash) ? 'dotted' : 'dashed') : 'solid'} ${css(line.color)};` : '';
          shapeHtml = `<div class="shp" style="inset:${r2(-lw / 2)}px;border-radius:${radius};${bg}${border}">${fill && fill.img ? `<img data-media="${esc(fill.img)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : ''}</div>`;
        } else {
          const d = prst === 'cust' ? custPath(spPr, b.w, b.h) : presetPath(prst, b.w, b.h, av);
          if (d) {
            const isLine = prst === 'line' || prst === 'straightConnector1';
            const fillAttr = isLine ? 'none' : fill && fill.css ? fill.css.replace(/"/g, "'") : 'none';
            const stroke = line ? `stroke="${css(line.color)}" stroke-width="${r2(line.w)}"${line.dash ? ' stroke-dasharray="6 4"' : ''}` : '';
            shapeHtml = `<svg class="shp" viewBox="0 0 ${r2(b.w)} ${r2(b.h)}" preserveAspectRatio="none" style="overflow:visible"><path d="${d}" fill="${fillAttr}" ${stroke} stroke-linejoin="round"/></svg>`;
          } else {
            shapeHtml = `<div class="shp" style="${fill && fill.css ? `background:${fill.css};` : ''}${line ? `border:${r2(line.w)}px solid ${css(line.color)};` : ''}"></div>`;
            warnings.add(`Shape “${prst}” is drawn as a rectangle`);
          }
        }
      }
      const isTitle = phInfo && ['title', 'ctrTitle'].includes(phInfo.type);
      const before = c.texts.length;
      const textHtml = hasText ? renderText(txBody, textStylesFor(sp, phInfo, c), bodyPrFor(sp, phInfo, c), c) : '';
      if (isTitle) c.titleText = c.texts.slice(before).join(' ');
      if (phInfo && phInfo.type === 'ftr') c.texts.length = before; // footers aren't content
      if (!shapeHtml && !textHtml) return '';
      return `<div class="el" style="${posStyle(b)}">${shapeHtml}${textHtml}</div>`;
    }

    function renderPic(pic, partName, c, xf) {
      const cNvPr = dig(pic, 'nvPicPr', 'cNvPr');
      if (attr(cNvPr, 'hidden') === '1') return '';
      if (isNav(cNvPr)) { c.navHidden++; return ''; }
      const spPr = kid(pic, 'spPr');
      let xfrm = kid(spPr, 'xfrm');
      const phEl = dig(pic, 'nvPicPr', 'nvPr', 'ph');
      if (!xfrm && phEl) { const info = { type: attr(phEl, 'type') || 'body', idx: attr(phEl, 'idx') }; const lp = c.findPh(c.layoutPhs, info, true); xfrm = kid(kid(lp && lp.el, 'spPr'), 'xfrm'); }
      if (!xfrm) return '';
      const b = box(xfrm, xf);
      const blipFill = kid(pic, 'blipFill'), blip = kid(blipFill, 'blip');
      const target = c.mediaFor(partName, rId(blip)) || c.mediaFor(partName, rId(blip, 'link'));
      if (!target) return '';
      const src = kid(blipFill, 'srcRect');
      const cl = num(attr(src, 'l')) / 100000, ct = num(attr(src, 't')) / 100000, cr = num(attr(src, 'r')) / 100000, cb = num(attr(src, 'b')) / 100000;
      const iw = b.w / Math.max(0.01, 1 - cl - cr), ih = b.h / Math.max(0.01, 1 - ct - cb);
      useMedia(target, iw, ih);
      const alpha = kid(blip, 'alphaModFix');
      const op = alpha ? num(attr(alpha, 'amt'), 100000) / 100000 : 1;
      const geom = attr(kid(spPr, 'prstGeom'), 'prst');
      const radius = geom === 'ellipse' ? '50%' : geom === 'roundRect' ? `${r2(Math.min(b.w, b.h) * 0.16667)}px` : '0';
      const line = lineOf(spPr, kid(pic, 'style'), c);
      const border = line ? `<div class="shp" style="inset:${r2(-line.w / 2)}px;border:${r2(line.w)}px solid ${css(line.color)};border-radius:${radius}"></div>` : '';
      const ext = target.split('.').pop().toLowerCase();
      if (['emf', 'wmf'].includes(ext)) warnings.add('Some images are in EMF/WMF format, which browsers can’t display');
      return `<div class="el" style="${posStyle(b)}"><div class="pic" style="border-radius:${radius};${op < 1 ? `opacity:${r2(op)};` : ''}"><img data-media="${esc(target)}" alt="${esc(attr(cNvPr, 'descr') || '')}" style="left:${r2(-cl * iw)}px;top:${r2(-ct * ih)}px;width:${r2(iw)}px;height:${r2(ih)}px"></div>${border}</div>`;
    }

    function renderCxn(cx, c, xf) {
      const spPr = kid(cx, 'spPr'), xfrm = kid(spPr, 'xfrm');
      if (!xfrm) return '';
      const b = box(xfrm, xf);
      const line = lineOf(spPr, kid(cx, 'style'), c);
      if (!line) return '';
      const prst = attr(kid(spPr, 'prstGeom'), 'prst') || 'line';
      let d = `M0,0 L${r2(b.w)},${r2(b.h)}`;
      if (/bentConnector/.test(prst)) d = `M0,0 L${r2(b.w / 2)},0 L${r2(b.w / 2)},${r2(b.h)} L${r2(b.w)},${r2(b.h)}`;
      const id = `m${Math.random().toString(36).slice(2, 8)}`;
      const marker = (type, which) => (type && type !== 'none' ? `<marker id="${id}${which}" viewBox="0 0 10 10" refX="${which === 'e' ? 8 : 2}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${css(line.color)}"/></marker>` : '');
      const defs = marker(line.tail, 'e') + marker(line.head, 's');
      const b2 = { ...b, w: Math.max(b.w, 1), h: Math.max(b.h, 1) };
      return `<div class="el" style="${posStyle(b2)}"><svg class="shp" viewBox="0 0 ${r2(b2.w)} ${r2(b2.h)}" preserveAspectRatio="none" style="overflow:visible">${defs ? `<defs>${defs}</defs>` : ''}<path d="${d}" fill="none" stroke="${css(line.color)}" stroke-width="${r2(line.w)}"${line.dash ? ' stroke-dasharray="6 4"' : ''}${line.tail && line.tail !== 'none' ? ` marker-end="url(#${id}e)"` : ''}${line.head && line.head !== 'none' ? ` marker-start="url(#${id}s)"` : ''}/></svg></div>`;
    }

    function renderGrp(g, partName, c, opts, xf) {
      const gx = dig(g, 'grpSpPr', 'xfrm');
      let inner = xf;
      if (gx) {
        const off = kid(gx, 'off'), ext = kid(gx, 'ext'), chOff = kid(gx, 'chOff'), chExt = kid(gx, 'chExt');
        const gsx = num(attr(chExt, 'cx')) ? num(attr(ext, 'cx')) / num(attr(chExt, 'cx')) : 1;
        const gsy = num(attr(chExt, 'cy')) ? num(attr(ext, 'cy')) / num(attr(chExt, 'cy')) : 1;
        inner = {
          ox: xf.ox + (num(attr(off, 'x')) - num(attr(chOff, 'x')) * gsx) * xf.sx,
          oy: xf.oy + (num(attr(off, 'y')) - num(attr(chOff, 'y')) * gsy) * xf.sy,
          sx: gsx * xf.sx, sy: gsy * xf.sy,
        };
      }
      let html = '';
      for (const el of g.children) if (!['nvGrpSpPr', 'grpSpPr'].includes(el.localName)) html += renderNode(el, partName, c, opts, inner);
      return html;
    }

    function renderFrame(gf, partName, c, xf) {
      const xfrm = kid(gf, 'xfrm');
      if (!xfrm) return '';
      const b = box(xfrm, xf);
      const data = dig(gf, 'graphic', 'graphicData');
      const tbl = kid(data, 'tbl');
      if (tbl) return `<div class="el" style="${posStyle(b)};height:auto">${renderTable(tbl, c)}</div>`;
      const uri = attr(data, 'uri') || '';
      const what = /chart/.test(uri) ? 'Chart' : /diagram/.test(uri) ? 'SmartArt graphic' : 'Embedded object';
      warnings.add(`${what}s can’t be shown: export the presentation as PDF to keep them`);
      return `<div class="el unsupported" style="${posStyle(b)}"><span>${what} not supported</span></div>`;
    }

    function renderTable(tbl, c) {
      const tblPr = kid(tbl, 'tblPr');
      const styleIdEl = kid(tblPr, 'tableStyleId');
      const style = tableStyle(styleIdEl ? styleIdEl.textContent.trim() : '', c);
      const flags = { firstRow: attr(tblPr, 'firstRow') === '1', lastRow: attr(tblPr, 'lastRow') === '1', bandRow: attr(tblPr, 'bandRow') === '1', firstCol: attr(tblPr, 'firstCol') === '1', lastCol: attr(tblPr, 'lastCol') === '1', bandCol: attr(tblPr, 'bandCol') === '1' };
      const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => num(attr(g, 'w')) * k);
      const rows = kids(tbl, 'tr');
      let html = `<table class="ptbl" style="width:${r2(cols.reduce((a, x) => a + x, 0))}px"><colgroup>${cols.map((w) => `<col style="width:${r2(w)}px">`).join('')}</colgroup>`;
      rows.forEach((tr, ri) => {
        html += `<tr style="height:${r2(num(attr(tr, 'h')) * k)}px">`;
        let ci = 0;
        for (const tc of kids(tr, 'tc')) {
          const colIndex = ci; ci += num(attr(tc, 'gridSpan'), 1);
          if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
          const parts = [];
          parts.push('wholeTbl');
          if (flags.bandRow) { const bi = ri - (flags.firstRow ? 1 : 0); if (bi >= 0 && !(flags.lastRow && ri === rows.length - 1)) parts.push(bi % 2 === 0 ? 'band1H' : 'band2H'); }
          if (flags.bandCol) parts.push(colIndex % 2 === 0 ? 'band1V' : 'band2V');
          if (flags.firstCol && colIndex === 0) parts.push('firstCol');
          if (flags.lastCol && colIndex === cols.length - 1) parts.push('lastCol');
          if (flags.lastRow && ri === rows.length - 1) parts.push('lastRow');
          if (flags.firstRow && ri === 0) parts.push('firstRow');
          let bg = null, run = {}, borders = {};
          for (const p of parts) { const s = style[p]; if (!s) continue; if (s.fill !== undefined) bg = s.fill; run = { ...run, ...s.run }; Object.assign(borders, s.borders || {}); }
          const tcPr = kid(tc, 'tcPr');
          if (kid(tcPr, 'solidFill')) bg = css(colorOf(kid(tcPr, 'solidFill'), c));
          if (kid(tcPr, 'noFill')) bg = null;
          for (const [side, tag] of [['left', 'lnL'], ['right', 'lnR'], ['top', 'lnT'], ['bottom', 'lnB']]) {
            const ln = kid(tcPr, tag);
            if (ln) borders[side] = kid(ln, 'noFill') ? null : { w: Math.max(0.6, num(attr(ln, 'w'), 12700) * k), color: css(colorOf(kid(ln, 'solidFill'), c)) };
          }
          const pad = `${r2(num(attr(tcPr, 'marT'), 45720) * k)}px ${r2(num(attr(tcPr, 'marR'), 91440) * k)}px ${r2(num(attr(tcPr, 'marB'), 45720) * k)}px ${r2(num(attr(tcPr, 'marL'), 91440) * k)}px`;
          const va = { t: 'top', ctr: 'middle', b: 'bottom' }[attr(tcPr, 'anchor') || 't'];
          const bcss = ['left', 'right', 'top', 'bottom'].map((s) => (borders[s] ? `border-${s}:${r2(borders[s].w)}px solid ${borders[s].color};` : '')).join('');
          const styles = mergeLevels(c.styles.pres, c.styles.other, Array.from({ length: 9 }, () => ({ para: {}, run })));
          const inner = renderText(kid(tc, 'txBody'), styles, { lIns: 0, tIns: 0, rIns: 0, bIns: 0 }, c);
          const span = `${num(attr(tc, 'gridSpan'), 1) > 1 ? ` colspan="${attr(tc, 'gridSpan')}"` : ''}${num(attr(tc, 'rowSpan'), 1) > 1 ? ` rowspan="${attr(tc, 'rowSpan')}"` : ''}`;
          html += `<td${span} style="padding:${pad};vertical-align:${va};${bg ? `background:${bg};` : ''}${bcss}">${inner.replace('class="tx"', 'class="tx tcell"')}</td>`;
        }
        html += '</tr>';
      });
      return html + '</table>';
    }

    let body = '';
    const showMaster = (doc) => !doc || attr(doc.documentElement, 'showMasterSp') !== '0';
    if (mDoc && showMaster(lDoc) && showMaster(sDoc)) body += renderTree(dig(mDoc.documentElement, 'cSld', 'spTree'), masterPart, ctx, { decorOnly: true });
    if (lDoc && showMaster(sDoc)) body += renderTree(dig(lDoc.documentElement, 'cSld', 'spTree'), layoutPart, ctx, { decorOnly: true });
    body += renderTree(dig(sDoc.documentElement, 'cSld', 'spTree'), part, ctx, {});

    const notesPart = byType(sRels, 'notesSlide') && byType(sRels, 'notesSlide').target;
    let notes = '';
    if (notesPart) {
      const nDoc = await loadXml(notesPart);
      if (nDoc) for (const sp of nDoc.getElementsByTagNameNS('*', 'sp')) {
        const ph = sp.getElementsByTagNameNS('*', 'ph')[0];
        if (ph && (attr(ph, 'type') === 'body' || (!attr(ph, 'type') && attr(ph, 'idx') === '1'))) {
          notes = [...sp.getElementsByTagNameNS('*', 'p')].map((p) => [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join('')).join('\n').trim();
        }
      }
    }

    const bgStyle = typeof bgHtml === 'string' ? bgHtml : 'background:#fff';
    const bgImg = typeof bgHtml === 'object' ? `<img class="bgimg" data-media="${esc(bgHtml.img)}">` : '';
    const html = `<div class="pptx-slide-inner" style="width:${DESIGN_WIDTH}px;height:${H}px;${bgStyle}">${bgImg}${body}</div>`;
    const content = ctx.texts.filter((t) => t && t !== ctx.titleText);
    footers.push(ctx.footer);
    slides.push({
      kind: 'pptx', index: si + 1, html, w: DESIGN_WIDTH, h: H,
      title: ctx.titleText, notes, footer: ctx.footer,
      label: (content.join(' · ') || ctx.titleText || `Slide ${si + 1}`).replace(/\s+/g, ' ').slice(0, 120),
      hidden: attr(sDoc.documentElement, 'show') === '0',
      section: sectionOf[sldIds[si].id] || '',
      navHidden: ctx.navHidden,
    });
  }

  // IDs: footer text if it identifies slides (e.g. item numbers), otherwise the slide number
  const usable = footers.filter((f) => f && f.length <= 16);
  const unique = new Set(usable).size;
  const useFooter = usable.length >= Math.max(2, slides.length * 0.3) && unique >= usable.length * 0.8;
  const seen = new Set();
  for (const s of slides) {
    let id = useFooter && s.footer && s.footer.length <= 16 ? slugId(s.footer) : '';
    if (!id || seen.has(id)) id = `s${String(s.index).padStart(2, '0')}`;
    seen.add(id);
    s.id = id;
  }

  // media
  const media = new Map();
  let mi = 0;
  for (const [part, maxPx] of mediaUse) {
    report(`Reading images ${++mi} of ${mediaUse.size}…`, 0.5 + (mi / Math.max(1, mediaUse.size)) * 0.2);
    const e = zip.get(part);
    if (!e) continue;
    media.set(part, { blob: new Blob([await e.read()], { type: mimeFor(part) }), maxDisplayPx: maxPx });
  }
  return { width: DESIGN_WIDTH, height: H, slides, media, warnings: [...warnings], usedFooterIds: useFooter };
}

function fakeScheme(val) {
  const d = new DOMParser().parseFromString(`<x><schemeClr val="${val}"/></x>`, 'application/xml');
  return d.documentElement;
}
function gradientCss(grad, ctx) {
  const stops = kids(kid(grad, 'gsLst'), 'gs').map((g) => ({ pos: num(attr(g, 'pos')) / 1000, c: colorOf(g, ctx) })).sort((a, b) => a.pos - b.pos);
  if (!stops.length) return 'transparent';
  const lin = kid(grad, 'lin');
  const ang = lin ? num(attr(lin, 'ang')) / 60000 + 90 : 180;
  if (kid(grad, 'path')) return `radial-gradient(${stops.map((s) => `${css(s.c)} ${r2(s.pos)}%`).join(',')})`;
  return `linear-gradient(${r2(ang)}deg,${stops.map((s) => `${css(s.c)} ${r2(s.pos)}%`).join(',')})`;
}
function autoLabel(type, n) {
  if (/alphaLc/.test(type)) return String.fromCharCode(96 + ((n - 1) % 26) + 1) + (/Paren/.test(type) ? ')' : '.');
  if (/alphaUc/.test(type)) return String.fromCharCode(64 + ((n - 1) % 26) + 1) + (/Paren/.test(type) ? ')' : '.');
  if (/roman/i.test(type)) { const r = toRoman(n); return (/romanLc/.test(type) ? r.toLowerCase() : r) + '.'; }
  return n + (/ParenR/.test(type) ? ')' : /Paren/.test(type) ? ')' : '.');
}
function toRoman(n) { const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, c] of m) while (n >= v) { s += c; n -= v; } return s; }
function slugId(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24); }
export function mimeFor(p) {
  const e = p.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp', emf: 'image/emf', wmf: 'image/wmf' }[e] || 'application/octet-stream';
}

// ---------- table styles ----------
// Only "Medium Style 2" (PowerPoint's default) is built in; other styles fall back to it.
const MEDIUM2 = { '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1', '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1', '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2', '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3', '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4', '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5', '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6' };
function tableStyle(id, ctx) {
  const accent = MEDIUM2[id] || 'accent1';
  const mk = (val, mods = '') => colorOf(new DOMParser().parseFromString(`<x><schemeClr val="${val}">${mods}</schemeClr></x>`, 'application/xml').documentElement, ctx);
  const white = css(mk('lt1'));
  const line = { w: 12700 * ctx.k, color: white };
  const all = { left: line, right: line, top: line, bottom: line };
  const base = accent === 'dk1' ? 'dk1' : accent;
  return {
    wholeTbl: { fill: css(mk(base, '<tint val="20000"/>')), run: { color: mk('dk1') }, borders: all },
    band1H: { fill: css(mk(base, '<tint val="40000"/>')) },
    band1V: { fill: css(mk(base, '<tint val="40000"/>')) },
    firstRow: { fill: css(mk(base)), run: { b: true, color: mk('lt1') }, borders: { ...all, bottom: { w: 38100 * ctx.k, color: white } } },
    lastRow: { fill: css(mk(base)), run: { b: true, color: mk('lt1') } },
    firstCol: { fill: css(mk(base)), run: { b: true, color: mk('lt1') } },
    lastCol: { fill: css(mk(base)), run: { b: true, color: mk('lt1') } },
  };
}

// ---------- image optimization (browser only) ----------
// Downscales each image to what it needs for the size it is shown at (×2.2 for Retina screens).
export async function optimizeImage(blob, maxDisplayPx) {
  const type = blob.type;
  if (!/^image\/(png|jpeg|gif|bmp|tiff|webp)$/.test(type)) return blob;
  const target = Math.min(2560, Math.max(160, Math.ceil(maxDisplayPx * 2.2)));
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch (_) { return blob; }
  const big = Math.max(bmp.width, bmp.height);
  if (big <= target * 1.15 && blob.size < 1.5e6) { bmp.close && bmp.close(); return blob; }
  const s = Math.min(1, target / big);
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const out = canvas.convertToBlob ? await canvas.convertToBlob({ type: outType, quality: 0.86 })
    : await new Promise((res) => canvas.toBlob(res, outType, 0.86));
  return out && out.size < blob.size ? out : blob;
}
