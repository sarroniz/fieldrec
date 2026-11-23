// In-app protocol editor: build a protocol without writing any files by hand.
// Saves to the "protocol.json" format (plus media files) inside the browser's storage.

import { renderSlide, renderMarkdown, layoutPptx, slugify, plainText, referencedImages, QUESTION_TYPES, QUESTION_TEXT } from './protocol.js';

export const PRESETS = {
  word_list: { label: 'Word or sentence list', recording: 'per_token', randomize: 'blocked',
    hint: 'One word or sentence per slide. The participant reads each one aloud and every item is saved as its own file.' },
  picture_naming: { label: 'Picture naming', recording: 'per_token', randomize: 'blocked',
    hint: 'One picture per slide. The participant says what they see; every item is saved as its own file.' },
  reading: { label: 'Reading passage', recording: 'continuous', randomize: false,
    hint: 'A text read aloud from start to finish. You get one recording and a TextGrid marking each slide.' },
  story: { label: 'Story from pictures', recording: 'both', randomize: false,
    hint: 'A sequence of pictures to narrate. You get one continuous recording plus a separate file for each slide.' },
  interview: { label: 'Interview or open questions', recording: 'continuous', randomize: false,
    hint: 'Questions shown one by one during a conversation, recorded continuously.' },
  text_questions: { label: 'Text answers (questionnaire)', recording: 'none', randomize: false,
    hint: 'Questions answered by typing, such as background information (age, place of birth, languages). Answers are saved in responses.csv.' },
  multiple_choice: { label: 'Multiple choice', recording: 'none', randomize: false,
    hint: 'Questions answered by choosing one option or several. Answers are saved in responses.csv.' },
  info: { label: 'Information only', recording: 'none', randomize: false,
    hint: 'Introductions, instructions or practice explanations. Slides are shown but nothing is recorded.' },
  custom: { label: 'Custom', recording: 'per_token', randomize: false,
    hint: 'Choose the recording mode and order yourself.' },
};
const REC_LABELS = {
  per_token: 'Each slide separately', continuous: 'One continuous recording', both: 'Continuous + one file per slide', none: 'No recording',
};
const REC_HINTS = {
  per_token: 'A red record button appears on every slide: tap to start and stop. Each take is saved as its own WAV file.',
  continuous: 'Recording starts on the first slide and stops after the last one. You get one WAV file and a TextGrid marking each slide.',
  both: 'One continuous WAV file for the whole task, plus a separate WAV file cut for each slide.',
  none: 'The slides are shown, but nothing is recorded.',
};
const ORDER_LABELS = { false: 'Fixed order', blocked: 'Random order', full: 'Fully random' };

const CONSENT_TEMPLATES = {
  en: `# Informed consent

**[Replace this text with the consent form approved by your IRB.]**

You are invited to take part in a study about language. The session takes about 20 minutes and includes reading words and sentences, describing pictures and a short conversation.

Your recordings are stored with a participant code, never with your name. You can stop at any time without giving a reason.

If you have questions, please contact the researcher in charge of the study.`,
  es: `# Consentimiento informado

**[Sustituye este texto por el formulario de consentimiento aprobado por tu IRB.]**

Te invitamos a participar en un estudio sobre el lenguaje. La sesión dura unos 20 minutos e incluye la lectura de palabras y frases, la descripción de imágenes y una breve conversación.

Las grabaciones se guardan con un código de participante, nunca con tu nombre. Puedes dejar la sesión en cualquier momento sin dar explicaciones.

Si tienes preguntas, puedes escribir a la persona responsable del estudio.`,
};

let A = null;          // helpers from app.js
let draft = null;      // { title, language, author, consent, tasks: [...] }
let assets = null;     // Map(path → { type, data: ArrayBuffer })
let urls = null;       // Map(path → object URL)
let recId = null, recCreated = null, sourceFormat = null;
let dirty = false;
let selected = new Set(); // slide uids

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = (n) => String(n).padStart(2, '0');

function resolve(path) {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const key = A.normPath(path);
  if (!urls.has(key)) {
    const a = assets.get(key) || [...assets.entries()].find(([k]) => k.split('/').pop().toLowerCase() === key.split('/').pop().toLowerCase())?.[1];
    urls.set(key, a ? URL.createObjectURL(new Blob([a.data], { type: a.type })) : '');
  }
  return urls.get(key);
}
function resetUrls() { if (urls) for (const u of urls.values()) if (u) URL.revokeObjectURL(u); urls = new Map(); }

// Default task names shown to participants, in the protocol's language
const TASK_NAMES_ES = {"word_list": "Lista de palabras", "picture_naming": "Denominación de imágenes", "reading": "Lectura", "story": "Narración con imágenes", "interview": "Conversación", "text_questions": "Cuestionario", "multiple_choice": "Preguntas de opción múltiple", "info": "Información", "custom": "Nueva tarea"};
const defaultTaskName = (key) => (draft && draft.language === 'es' ? TASK_NAMES_ES[key] : null) || (key === 'custom' ? 'New task' : (PRESETS[key] || PRESETS.custom).label);
const isDefaultName = (label) => !label || label === 'New task' || Object.values(PRESETS).some((x) => x.label === label) || Object.values(TASK_NAMES_ES).includes(label);
function newTask(presetKey = 'custom', label) {
  const p = PRESETS[presetKey] || PRESETS.custom;
  return { uid: uid(), task: '', label: label || defaultTaskName(presetKey), preset: presetKey, recording: p.recording, randomize: p.randomize, repetitions: 1, instructions: '', slides: [] };
}
const taskOf = (tuid) => draft.tasks.find((t) => t.uid === tuid);
function findSlide(suid) { for (const t of draft.tasks) { const i = t.slides.findIndex((s) => s.uid === suid); if (i >= 0) return { task: t, index: i, slide: t.slides[i] }; } return null; }
function markDirty() { dirty = true; const b = document.getElementById('ed-dirty'); if (b) b.textContent = 'Unsaved changes'; }
function uniqueId(task, id, self) {
  let base = slugify(id) || 's', out = base, n = 2;
  while (task.slides.some((s) => s !== self && s.id === out)) out = `${base}_${n++}`;
  return out;
}

// ---------- entry ----------
export async function openEditor(api, { entry = null, start = null } = {}) {
  A = api; dirty = false; selected = new Set(); assets = new Map(); resetUrls();
  recId = null; recCreated = null; sourceFormat = null;
  if (entry) await loadFrom(entry);
  else draft = { title: 'Untitled protocol', language: 'en', author: '', consent: '', tasks: [] };
  render(true);
  if (start === 'deck') {
    const t = newTask('custom', 'Slides');
    draft.tasks.push(t);
    render();
    pickFiles(t.uid, 'deck');
  }
}

async function loadFrom(entry) {
  const proto = await A.loadProtocolEntry(entry);
  sourceFormat = proto.format || 'markdown';
  if (entry.kind === 'imported') { recId = entry.id; recCreated = entry.record.importedAt; }
  draft = {
    title: entry.kind === 'imported' ? proto.title : `${proto.title} (copy)`,
    language: (proto.meta && proto.meta.language) || 'en',
    author: (proto.meta && proto.meta.author) || '',
    consent: proto.consent || '',
    tasks: proto.tasks.map((t) => ({
      uid: uid(), task: t.name, label: t.title, preset: t.preset || '', recording: t.recording, randomize: t.randomize || false,
      repetitions: t.repetitions || 1, instructions: t.instructions || '',
      slides: t.slides.map((s) => ({ ...s, kind: s.kind || 'md', uid: uid() })),
    })),
  };
  if (entry.kind === 'imported') {
    // Copy the stored files directly (they are already { type, data: ArrayBuffer } after loadProtocolEntry)
    for (const [n, v] of Object.entries(entry.record.files || {})) {
      if (/\.(json|md|markdown|csv|tsv|txt)$/i.test(n)) continue;
      const data = v instanceof Blob ? await v.arrayBuffer() : v && v.data;
      if (data) assets.set(A.normPath(n), { type: (v && v.type) || A.guessType(n), data });
    }
  } else {
    for (const p of referencedImages(proto)) {
      const u = proto.resolve(p);
      if (!u || /^(data|blob):/.test(u)) continue;
      try {
        const r = await fetch(u);
        if (r.ok) { const b = await r.blob(); assets.set(A.normPath(p), { type: b.type || A.guessType(p), data: await b.arrayBuffer() }); }
      } catch (_) {}
    }
  }
}

// ---------- missing pictures ----------
function findAsset(p) {
  const key = A.normPath(p);
  return assets.get(key) || [...assets.entries()].find(([k]) => k.split('/').pop().toLowerCase() === key.split('/').pop().toLowerCase())?.[1] || null;
}
function missingPaths() {
  const proto = { consent: draft.consent, tasks: draft.tasks.map((t) => ({ slides: t.slides })) };
  return referencedImages(proto).map((p) => A.normPath(p)).filter((p) => !findAsset(p));
}
// Puts back missing pictures from the original .pptx (its ppt/media files) or from picture files, matching by file name.
async function restorePictures(files) {
  const { openZip } = await import('./unzip.js');
  const { optimizeImage, mimeFor } = await import('./pptx.js');
  let missing = missingPaths();
  const stem = (n) => n.split('/').pop().toLowerCase().replace(/\.[^.]+$/, '');
  let restored = 0;
  for (const f of files) {
    const candidates = [];
    if (/\.pptx$/i.test(f.name)) {
      progress(`Reading ${f.name}…`, 0);
      const zip = await openZip(f);
      // prefer the folder this presentation was imported into (media/<file name>…)
      const folder = `media/${slugify(f.name.replace(/\.[^.]+$/, ''), 24)}`;
      const scoped = missing.filter((p) => p.startsWith(folder + '/') || p.startsWith(folder + '_'));
      const pool = scoped.length ? scoped : missing;
      for (const e of zip.entries) if (e.name.startsWith('ppt/media/')) candidates.push({ name: e.name, pool, get: async () => new Blob([await e.read()], { type: mimeFor(e.name) }) });
    } else {
      candidates.push({ name: f.name, pool: missing, get: async () => f });
    }
    let i = 0;
    for (const c of candidates) {
      const targets = c.pool.filter((p) => stem(p) === stem(c.name) && !findAsset(p));
      i++;
      if (!targets.length) continue;
      progress(`Restoring pictures… ${restored + 1}`, i / candidates.length);
      const out = await optimizeImage(await c.get(), 1000);
      const data = await out.arrayBuffer();
      for (const p of targets) { assets.set(p, { type: out.type || A.guessType(p), data }); restored++; }
    }
    missing = missingPaths();
  }
  closeProgress();
  resetUrls();
  if (restored) markDirty();
  render();
  const left = missingPaths().length;
  A.toast(restored ? `Restored ${restored} pictures${left ? ` · ${left} still missing` : ''}. Tap Save to keep them.` : 'No matching pictures found in that file', restored ? '' : 'err');
}
function pickRestore() {
  const input = document.getElementById('ed-file');
  input.value = '';
  input.multiple = true;
  input.accept = '.pptx,image/*,.png,.jpg,.jpeg,.gif,.webp,.svg';
  input.onchange = async () => {
    const files = [...input.files];
    if (!files.length) return;
    try { await restorePictures(files); } catch (err) { closeProgress(); A.modal({ title: 'Couldn’t restore the pictures', body: `<p>${esc(err.message)}</p>`, cancel: '', ok: 'OK' }); }
  };
  input.click();
}

// ---------- rendering ----------
function render(top = false) {
  const scroller = document.scrollingElement || document.documentElement;
  const y = top ? 0 : (A.app.scrollTop || scroller.scrollTop);
  A.app.className = 'scroll';
  A.app.innerHTML = `<div class="page editor">
    <header class="topbar"><button class="btn ghost back" id="ed-back">‹ Protocols</button><h2>Protocol editor</h2>
      <div class="tb-right"><span class="muted small" id="ed-dirty">${dirty ? 'Unsaved changes' : ''}</span><button class="btn primary" data-a="save">Save</button></div></header>
    ${(() => { const n = missingPaths().length; return n ? `<div class="notice warn"><b>${n} ${n === 1 ? 'picture used by these slides is' : 'pictures used by these slides are'} missing.</b>
      An earlier version of FieldRec could lose pictures when an edited protocol was saved. If they came from a PowerPoint, choose that same .pptx file to put them back: your tasks and slide order stay as they are. You can also choose the picture files.
      <div class="row gap wrap" style="margin-top:10px"><button class="btn primary" data-a="restore">Restore from PowerPoint or pictures</button></div></div>` : ''; })()}
    ${sourceFormat === 'markdown' && recId ? '<div class="notice">This protocol was imported from a Markdown file. Saving it here converts it to the editor’s format; the original file isn’t changed.</div>' : ''}
    <section class="panel">
      <h3><span class="stepnum">1</span> About this protocol</h3>
      <div class="cols">
        <label class="field"><span>Title</span><input id="ed-title" value="${esc(draft.title)}"></label>
        <label class="field"><span>Language shown to participants</span><select id="ed-lang">
          <option value="en" ${draft.language === 'en' ? 'selected' : ''}>English</option><option value="es" ${draft.language === 'es' ? 'selected' : ''}>Español</option></select>
          <small>Used for the consent checkboxes, “Task 1 of 3”, and the break and thank-you screens.</small></label>
      </div>
      <label class="field"><span>Consent text</span><textarea id="ed-consent" rows="5" placeholder="Paste your IRB-approved consent text here…">${esc(draft.consent)}</textarea>
        <small>Shown at the start of every session, above the consent checkboxes. <a href="#" data-a="consent-tpl">Insert a template</a></small></label>
    </section>
    <section class="panel">
      <h3><span class="stepnum">2</span> Tasks and slides</h3>
      <p class="muted">A <b>task</b> is a group of slides recorded the same way, such as a word list or a reading passage. Participants go through the tasks in this order.</p>
      ${draft.tasks.map(renderTask).join('') || '<div class="empty">No tasks yet. Add your first task below.</div>'}
      <div class="row gap wrap"><button class="btn primary" data-a="add-task">+ Add a task</button>
        <button class="btn" data-a="add-deck-task">+ New task from PowerPoint or PDF</button></div>
    </section>
    <section class="panel">
      <h3><span class="stepnum">3</span> Save and use it</h3>
      <p class="muted">Saved protocols appear in <b>New session</b>. Download the .zip to keep a backup or to use the protocol on another iPad (Protocols → Import).</p>
      <div class="row gap wrap"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="save-run">Save and start a session</button><button class="btn" data-a="zip">Download .zip</button></div>
    </section>
    <div class="selbar ${selected.size ? '' : 'hidden'}" id="ed-selbar">
      <b>${selected.size} selected</b>
      <label>Move to <select id="ed-move-to">${draft.tasks.map((t, i) => `<option value="${t.uid}">${i + 1}. ${esc(t.label)}</option>`).join('')}<option value="__new">New task…</option></select></label>
      <button class="btn primary" data-a="move-sel">Move</button>
      <button class="btn danger-t" data-a="del-sel">Delete</button>
      <button class="btn ghost" data-a="clear-sel">Clear</button>
    </div>
    <input type="file" id="ed-file" hidden>
  </div>`;
  layoutPptx(A.app);
  requestAnimationFrame(() => { if (A.app.scrollHeight > A.app.clientHeight + 4) A.app.scrollTop = y; else scroller.scrollTop = y; });
  bind();
}

function renderTask(t, i) {
  const presetOpts = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${t.preset === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  const recOpts = Object.entries(REC_LABELS).map(([k, l]) => `<option value="${k}" ${t.recording === k ? 'selected' : ''}>${l}</option>`).join('');
  const ordOpts = Object.entries(ORDER_LABELS).map(([k, l]) => `<option value="${k}" ${String(t.randomize) === k ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="task-card" data-t="${t.uid}">
    <div class="tc-head"><span class="tc-num">${i + 1}</span>
      <input class="tc-label" data-f="label" value="${esc(t.label)}" placeholder="Task name (participants see it)" aria-label="Task name">
      <div class="tc-actions"><button class="btn ghost" data-a="task-up" ${i === 0 ? 'disabled' : ''} aria-label="Move task up">↑</button><button class="btn ghost" data-a="task-down" ${i === draft.tasks.length - 1 ? 'disabled' : ''} aria-label="Move task down">↓</button><button class="btn ghost danger-t" data-a="task-del">Delete task</button></div></div>
    <div class="tc-grid">
      <label class="field"><span>Type of task</span><select data-f="preset"><option value="" ${t.preset ? '' : 'selected'}>—</option>${presetOpts}</select></label>
      <label class="field"><span>Recording</span><select data-f="recording">${recOpts}</select></label>
      <label class="field"><span>Slide order</span><select data-f="randomize">${ordOpts}</select></label>
      <label class="field"><span>Repetitions</span><input type="number" min="1" max="10" data-f="repetitions" value="${t.repetitions}"></label>
    </div>
    <p class="tc-hint">${REC_HINTS[t.recording]}${t.randomize === 'blocked' ? ' Slides are shuffled for each participant' + (t.repetitions > 1 ? ', within each repetition.' : '.') : t.randomize === 'full' ? ' All slides (and repetitions) are shuffled together for each participant.' : ''}${t.repetitions > 1 ? ` Each slide is shown ${t.repetitions} times.` : ''}</p>
    <label class="field"><span>Instructions screen before the task <em>(optional)</em></span><textarea data-f="instructions" rows="2" placeholder="e.g. Read each sentence aloud, at your normal pace.">${esc(t.instructions)}</textarea></label>
    <div class="slides-grid">${t.slides.map((s, j) => renderSlideCard(s, j, t)).join('') || '<div class="empty small">No slides yet. Add slides with the buttons below.</div>'}</div>
    <div class="add-row"><span class="muted">Add slides:</span>
      ${['text_questions', 'multiple_choice'].includes(t.preset) ? `<button class="btn primary" data-a="add-question">Question</button>
      ${t.preset === 'text_questions' ? '<button class="btn" data-a="add-bg">Sample background questions</button>' : ''}
      <button class="btn" data-a="add-text">Text</button>` : `<button class="btn" data-a="add-text">Text</button>
      <button class="btn" data-a="add-images">Pictures</button>
      <button class="btn" data-a="add-words">Word list</button>
      <button class="btn" data-a="add-deck">PowerPoint or PDF</button>
      <button class="btn" data-a="add-question">Question</button>`}</div>
  </div>`;
}

function renderSlideCard(s, j, t) {
  const kindLabel = s.kind === 'pptx' ? 'PowerPoint' : s.kind === 'image' ? 'Picture' : s.kind === 'question' ? 'Question' : 'Text';
  return `<div class="sl ${selected.has(s.uid) ? 'sel' : ''}" data-s="${s.uid}">
    <div class="thumb-in ${s.kind === 'pptx' ? 'is-pptx' : ''}" data-a="edit">${renderSlide(s, resolve, { texts: QUESTION_TEXT[draft.language] || QUESTION_TEXT.en })}</div>
    <button class="sl-check" data-a="sel" aria-label="Select slide">${selected.has(s.uid) ? '✓' : ''}</button>
    <div class="sl-meta"><b>${j + 1}</b><span title="${esc(s.label || '')}">${esc(s.id)}</span><em>${kindLabel}</em></div>
    <div class="sl-actions">
      <button class="btn ghost" data-a="edit">Edit</button>
      <button class="btn ghost" data-a="left" ${j === 0 ? 'disabled' : ''} aria-label="Move earlier">‹</button>
      <button class="btn ghost" data-a="right" ${j === t.slides.length - 1 ? 'disabled' : ''} aria-label="Move later">›</button>
      <button class="btn ghost danger-t" data-a="del" aria-label="Delete slide">✕</button>
    </div>
  </div>`;
}

// ---------- events ----------
function bind() {
  const root = A.app.querySelector('.editor');
  document.getElementById('ed-back').addEventListener('click', async () => {
    if (dirty && !(await A.modal({ title: 'Leave without saving?', body: '<p>Your changes to this protocol will be lost.</p>', ok: 'Discard changes', danger: true }))) return;
    resetUrls();
    A.go('protocols');
  });
  document.getElementById('ed-title').addEventListener('input', (e) => { draft.title = e.target.value; markDirty(); });
  document.getElementById('ed-lang').addEventListener('change', (e) => { draft.language = e.target.value; markDirty(); });
  document.getElementById('ed-consent').addEventListener('input', (e) => { draft.consent = e.target.value; markDirty(); });

  root.addEventListener('input', (e) => {
    const card = e.target.closest('.task-card'); const f = e.target.dataset.f;
    if (!card || !f) return;
    const t = taskOf(card.dataset.t);
    if (f === 'label') t.label = e.target.value;
    if (f === 'instructions') t.instructions = e.target.value;
    markDirty();
  });
  root.addEventListener('change', (e) => {
    const card = e.target.closest('.task-card'); const f = e.target.dataset.f;
    if (!card || !f) return;
    const t = taskOf(card.dataset.t);
    if (f === 'preset') {
      t.preset = e.target.value;
      const p = PRESETS[t.preset];
      if (p) { t.recording = p.recording; t.randomize = p.randomize; if (isDefaultName(t.label)) t.label = defaultTaskName(t.preset); }
    }
    if (f === 'recording') t.recording = e.target.value;
    if (f === 'randomize') t.randomize = e.target.value === 'false' ? false : e.target.value;
    if (f === 'repetitions') t.repetitions = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
    markDirty();
    if (['preset', 'recording', 'repetitions'].includes(f)) render();
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    const a = b.dataset.a;
    const card = b.closest('.task-card'); const t = card ? taskOf(card.dataset.t) : null;
    const sl = b.closest('.sl'); const found = sl ? findSlide(sl.dataset.s) : null;
    if (b.tagName === 'A') e.preventDefault();
    switch (a) {
      case 'save': return save();
      case 'restore': return pickRestore();
      case 'save-run': { const id = await save(); if (id) A.go('setup', id); return; }
      case 'zip': return downloadZip();
      case 'consent-tpl': {
        if (draft.consent.trim() && !(await A.modal({ title: 'Replace the consent text?', body: '<p>The current text will be replaced by a template.</p>', ok: 'Replace' }))) return;
        draft.consent = CONSENT_TEMPLATES[draft.language] || CONSENT_TEMPLATES.en; markDirty(); return render();
      }
      case 'add-task': { const key = await choosePreset(); if (!key) return; draft.tasks.push(newTask(key)); markDirty(); render(); scrollToTask(draft.tasks[draft.tasks.length - 1].uid); return; }
      case 'add-deck-task': { const nt = newTask('custom', 'Slides'); draft.tasks.push(nt); markDirty(); render(); return pickFiles(nt.uid, 'deck'); }
      case 'task-up': case 'task-down': {
        const i = draft.tasks.indexOf(t), j = a === 'task-up' ? i - 1 : i + 1;
        [draft.tasks[i], draft.tasks[j]] = [draft.tasks[j], draft.tasks[i]]; markDirty(); return render();
      }
      case 'task-del': {
        if (t.slides.length && !(await A.modal({ title: `Delete “${t.label}”?`, body: `<p>Its ${t.slides.length} slides will be deleted too.</p>`, ok: 'Delete task', danger: true }))) return;
        t.slides.forEach((s) => selected.delete(s.uid));
        draft.tasks.splice(draft.tasks.indexOf(t), 1); markDirty(); return render();
      }
      case 'add-text': return editSlide(t, null);
      case 'add-images': return pickFiles(t.uid, 'images');
      case 'add-words': return addWordList(t);
      case 'add-deck': return pickFiles(t.uid, 'deck');
      case 'add-question': return editQuestion(t, null, t.preset === 'multiple_choice' ? 'single' : 'short');
      case 'add-bg': return addBackgroundQuestions(t);
      case 'sel': { const id = found.slide.uid; if (selected.has(id)) selected.delete(id); else selected.add(id); return render(); }
      case 'edit': return found.slide.kind === 'question' ? editQuestion(found.task, found.slide) : editSlide(found.task, found.slide);
      case 'left': case 'right': {
        const arr = found.task.slides, i = found.index, j = a === 'left' ? i - 1 : i + 1;
        [arr[i], arr[j]] = [arr[j], arr[i]]; markDirty(); return render();
      }
      case 'del': {
        found.task.slides.splice(found.index, 1); selected.delete(found.slide.uid); markDirty(); return render();
      }
      case 'clear-sel': selected.clear(); return render();
      case 'del-sel': {
        if (!(await A.modal({ title: `Delete ${selected.size} slides?`, ok: 'Delete', danger: true }))) return;
        for (const tk of draft.tasks) tk.slides = tk.slides.filter((s) => !selected.has(s.uid));
        selected.clear(); markDirty(); return render();
      }
      case 'move-sel': {
        let dest = document.getElementById('ed-move-to').value;
        if (dest === '__new') { const key = await choosePreset(); if (!key) return; const nt = newTask(key); draft.tasks.push(nt); dest = nt.uid; }
        const target = taskOf(dest);
        const moving = [];
        for (const tk of draft.tasks) {
          if (tk === target) continue;
          const keep = [];
          for (const s of tk.slides) (selected.has(s.uid) ? moving : keep).push(s);
          tk.slides = keep;
        }
        for (const s of moving) { s.id = uniqueId(target, s.id, s); target.slides.push(s); }
        A.toast(`Moved ${moving.length} slides to “${target.label}”`);
        selected.clear(); markDirty(); render(); return scrollToTask(target.uid);
      }
      default: return undefined;
    }
  });
}

function scrollToTask(tuid) {
  requestAnimationFrame(() => { const el = A.app.querySelector(`.task-card[data-t="${tuid}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

function choosePreset() {
  return new Promise((resolveP) => {
    const m = document.createElement('div');
    m.className = 'modal-back';
    m.innerHTML = `<div class="modal wide"><h3>What kind of task is it?</h3>
      <p class="muted small">This sets the recording mode and slide order. You can change both later.</p>
      <div class="preset-list">${Object.entries(PRESETS).map(([k, p]) => `<button class="preset" data-k="${k}"><b>${esc(p.label)}</b><span>${esc(p.hint)}</span><em>${REC_LABELS[p.recording]} · ${p.randomize ? 'random order' : 'fixed order'}</em></button>`).join('')}</div>
      <div class="modal-actions"><button class="btn ghost" data-k="">Cancel</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; m.remove(); resolveP(b.dataset.k || null); });
  });
}

// ---------- adding slides ----------
function pickFiles(tuid, what) {
  const input = document.getElementById('ed-file');
  input.value = '';
  input.multiple = what === 'images';
  input.accept = what === 'images' ? 'image/*,.png,.jpg,.jpeg,.gif,.webp,.svg' : '.pptx,.pdf,.ppt,.key,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation';
  input.onchange = async () => {
    const files = [...input.files];
    if (!files.length) return;
    const t = taskOf(tuid);
    try {
      if (what === 'images') await addImages(t, files);
      else await importDeck(t, files[0]);
    } catch (err) {
      closeProgress();
      A.modal({ title: 'Couldn’t add the file', body: `<p>${esc(err.message)}</p>`, cancel: '', ok: 'OK' });
    }
  };
  input.click();
}

let progressEl = null;
function progress(msg, f) {
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.className = 'modal-back';
    progressEl.innerHTML = '<div class="modal"><h3>Importing…</h3><p class="muted" id="pg-msg"></p><div class="progress"><div id="pg-bar"></div></div></div>';
    document.body.appendChild(progressEl);
  }
  progressEl.querySelector('#pg-msg').textContent = msg;
  if (f != null) progressEl.querySelector('#pg-bar').style.width = `${Math.round(f * 100)}%`;
}
function closeProgress() { if (progressEl) { progressEl.remove(); progressEl = null; } }

function uniquePath(dir, name) {
  let base = name.replace(/\.[^.]+$/, ''), ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  base = slugify(base, 40) || 'file';
  let p = `${dir}/${base}${ext}`, n = 2;
  while (assets.has(p)) p = `${dir}/${base}_${n++}${ext}`;
  return p;
}
function uniqueFolder(name) {
  const base = slugify(name, 24) || 'slides';
  let f = `media/${base}`, n = 2;
  while ([...assets.keys()].some((k) => k.startsWith(f + '/'))) f = `media/${base}_${n++}`;
  return f;
}

async function addImages(t, files) {
  const { optimizeImage } = await import('./pptx.js');
  let i = 0;
  for (const f of files) {
    progress(`Adding picture ${++i} of ${files.length}…`, i / files.length);
    const blob = await optimizeImage(f, 1200);
    const ext = blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/png' ? '.png' : (f.name.match(/\.[^.]+$/) || ['.png'])[0];
    const path = uniquePath('media/pictures', f.name.replace(/\.[^.]+$/, '') + ext);
    assets.set(path, { type: blob.type || f.type, data: await blob.arrayBuffer() });
    const s = { uid: uid(), kind: 'image', src: path, caption: '', label: f.name.replace(/\.[^.]+$/, '') };
    s.id = uniqueId(t, s.label, s);
    t.slides.push(s);
  }
  closeProgress();
  markDirty(); render();
  A.toast(`Added ${files.length} ${files.length === 1 ? 'picture' : 'pictures'}`);
}

async function importDeck(t, file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'ppt') throw new Error('This is the old PowerPoint format (.ppt). Open it in PowerPoint and save it as .pptx (File → Save As), or export it as PDF, then import that file.');
  if (ext === 'key') throw new Error('Keynote files can’t be read directly. In Keynote, choose File → Export To → PowerPoint (or PDF), then import that file.');
  const folder = uniqueFolder(file.name.replace(/\.[^.]+$/, ''));
  const added = [];
  const notes = [];
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const { readPdf } = await import('./pdf-import.js');
    progress('Opening the PDF…', 0);
    const pages = await readPdf(file, { onProgress: progress });
    for (const pg of pages) {
      const path = `${folder}/page-${pad2(pg.index)}.jpg`;
      assets.set(path, { type: 'image/jpeg', data: await pg.blob.arrayBuffer() });
      added.push({ uid: uid(), kind: 'image', src: path, caption: '', id: `p${pad2(pg.index)}`, label: pg.label || `Page ${pg.index}` });
    }
  } else {
    const { readPptx, optimizeImage } = await import('./pptx.js');
    const res = await readPptx(file, { onProgress: progress });
    const map = {};
    let i = 0;
    for (const [part, m] of res.media) {
      progress(`Optimizing images ${++i} of ${res.media.size}…`, 0.7 + (i / Math.max(1, res.media.size)) * 0.3);
      const out = await optimizeImage(m.blob, m.maxDisplayPx);
      const oext = out.type === 'image/jpeg' ? 'jpg' : out.type === 'image/png' ? 'png' : part.split('.').pop();
      const path = `${folder}/${part.split('/').pop().replace(/\.[^.]+$/, '')}.${oext}`;
      assets.set(path, { type: out.type || m.blob.type, data: await out.arrayBuffer() });
      map[part] = path;
    }
    const hidden = res.slides.filter((s) => s.hidden).length;
    for (const s of res.slides) {
      if (s.hidden) continue;
      added.push({ uid: uid(), kind: 'pptx', id: s.id, label: s.label, title: s.title, notes: s.notes, section: s.section, w: s.w, h: s.h,
        html: s.html.replace(/data-media="([^"]+)"/g, (m0, p) => `data-media="${map[p] || p}"`) });
    }
    const nav = res.slides.reduce((a, s) => a + s.navHidden, 0);
    if (nav) notes.push(`${nav} navigation buttons (like “next”) were hidden, because FieldRec has its own Next button.`);
    if (hidden) notes.push(`${hidden} slides hidden in PowerPoint were skipped.`);
    if (res.usedFooterIds) notes.push('The numbers in the slides’ footers were used as item IDs in file names.');
    notes.push(...res.warnings);
  }
  closeProgress();
  // PowerPoint sections → one task per section (optional)
  const sections = [...new Set(added.map((s) => s.section).filter(Boolean))];
  let split = false;
  if (sections.length > 1) {
    split = await A.modal({ title: 'Use the presentation’s sections?', body: `<p>This presentation has ${sections.length} sections (${sections.map(esc).join(', ')}). FieldRec can create one task for each section, or put all the slides in “${esc(t.label)}”.</p>`, ok: 'One task per section', cancel: 'All in this task' });
  }
  if (split) {
    const at = draft.tasks.indexOf(t);
    const newTasks = sections.map((name) => { const nt = newTask('custom', name); nt.slides = added.filter((s) => s.section === name); return nt; });
    const rest = added.filter((s) => !s.section);
    rest.forEach((s) => { s.id = uniqueId(t, s.id, s); t.slides.push(s); });
    newTasks.forEach((nt) => nt.slides.forEach((s) => { s.id = uniqueId(nt, s.id, s); }));
    draft.tasks.splice(at + 1, 0, ...newTasks);
    if (!t.slides.length) draft.tasks.splice(at, 1);
  } else {
    for (const s of added) { s.id = uniqueId(t, s.id, s); t.slides.push(s); }
  }
  markDirty(); render(); scrollToTask(t.uid);
  await A.modal({
    title: `Added ${added.length} slides`,
    body: `${notes.length ? `<ul class="tips">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p><b>Next:</b> check that each slide is in the right task. Tap the circle on a slide to select it, then use <b>Move to</b> at the bottom of the screen (for example, to put practice slides in their own task). If a slide doesn’t look right, export the presentation as PDF and import the PDF instead.</p>`,
    cancel: '', ok: 'OK',
  });
}

async function addWordList(t) {
  const m = document.createElement('div');
  m.className = 'modal-back';
  m.innerHTML = `<div class="modal wide"><h3>Add a word list</h3>
    <label class="field"><span>One word or sentence per line</span><textarea id="wl-text" rows="8" placeholder="cada&#10;lado&#10;todo"></textarea></label>
    <label class="field"><span>Carrier phrase <em>(optional)</em></span><input id="wl-carrier" placeholder="Digo {text} otra vez."><small>Write <code>{text}</code> where each item goes. It is shown in bold.</small></label>
    <p class="muted small" id="wl-count">0 slides</p>
    <div class="modal-actions"><button class="btn ghost" data-r="0">Cancel</button><button class="btn primary" data-r="1">Add slides</button></div></div>`;
  document.body.appendChild(m);
  const ta = m.querySelector('#wl-text');
  const items = () => ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
  ta.addEventListener('input', () => { m.querySelector('#wl-count').textContent = `${items().length} slides`; });
  setTimeout(() => ta.focus(), 50);
  const ok = await new Promise((r) => m.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) r(b.dataset.r === '1'); }));
  const list = items(), carrier = m.querySelector('#wl-carrier').value.trim();
  m.remove();
  if (!ok || !list.length) return;
  for (const w of list) {
    const shown = carrier && carrier.includes('{text}') ? carrier.replace('{text}', `**${w}**`) : w;
    const s = { uid: uid(), kind: 'md', md: `# ${shown}`, label: w };
    s.id = uniqueId(t, w, s);
    t.slides.push(s);
  }
  markDirty(); render();
  A.toast(`Added ${list.length} slides`);
}

// ---------- editing one slide ----------
async function editSlide(t, slide) {
  const isNew = !slide;
  const s = slide ? { ...slide } : { uid: uid(), kind: 'md', md: '', id: '', label: '' };
  const m = document.createElement('div');
  m.className = 'modal-back';
  const textHelp = '<small><code># Big text</code> for a heading · <code>**bold**</code> · <code>*italics*</code> · a blank line starts a new paragraph</small>';
  m.innerHTML = `<div class="modal wide edit-slide"><h3>${isNew ? 'New text slide' : 'Edit slide'}</h3>
    <div class="es-cols">
      <div class="es-form">
        ${s.kind === 'md' ? `<label class="field"><span>Text</span><textarea id="es-md" rows="7" placeholder="# Digo cada otra vez">${esc(s.md)}</textarea>${textHelp}</label>` : ''}
        ${s.kind === 'image' ? `<label class="field"><span>Caption <em>(optional)</em></span><textarea id="es-cap" rows="3">${esc(s.caption || '')}</textarea>${textHelp}</label>
          <label class="btn">Replace picture<input type="file" id="es-img" accept="image/*" hidden></label>` : ''}
        ${s.kind === 'pptx' && s.notes ? `<div class="field"><span>Speaker notes (from PowerPoint)</span><div class="notes">${esc(s.notes)}</div></div>` : ''}
        <label class="field"><span>Item ID</span><input id="es-id" value="${esc(s.id)}" placeholder="automatic"><small>Used in file names and the TextGrid. Letters, numbers and _ only.</small></label>
      </div>
      <div class="es-preview"><span class="muted small">Preview</span><div class="thumb-in big ${s.kind === 'pptx' ? 'is-pptx' : ''}" id="es-prev"></div></div>
    </div>
    <div class="modal-actions"><button class="btn ghost" data-r="0">Cancel</button><button class="btn primary" data-r="1">${isNew ? 'Add slide' : 'Save slide'}</button></div></div>`;
  document.body.appendChild(m);
  const prev = m.querySelector('#es-prev');
  const refresh = () => { prev.innerHTML = renderSlide(s, resolve); layoutPptx(prev); };
  refresh();
  const md = m.querySelector('#es-md'); if (md) { md.addEventListener('input', () => { s.md = md.value; refresh(); }); setTimeout(() => md.focus(), 50); }
  const cap = m.querySelector('#es-cap'); if (cap) cap.addEventListener('input', () => { s.caption = cap.value; refresh(); });
  const img = m.querySelector('#es-img');
  if (img) img.addEventListener('change', async () => {
    const f = img.files[0]; if (!f) return;
    const { optimizeImage } = await import('./pptx.js');
    const blob = await optimizeImage(f, 1200);
    const path = uniquePath('media/pictures', f.name);
    assets.set(path, { type: blob.type || f.type, data: await blob.arrayBuffer() });
    s.src = path; refresh();
  });
  const ok = await new Promise((r) => m.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) r(b.dataset.r === '1'); }));
  const idVal = m.querySelector('#es-id').value;
  m.remove();
  if (!ok) return;
  if (s.kind === 'md') { if (!s.md.trim()) return; s.label = plainText(s.md).slice(0, 120); }
  if (s.kind === 'image' && s.caption) s.label = plainText(s.caption).slice(0, 120) || s.label;
  s.id = uniqueId(t, idVal || s.label || 's', slide || s);
  if (isNew) t.slides.push(s);
  else Object.assign(slide, s);
  markDirty(); render();
}

// ---------- questions ----------
const BACKGROUND = {
  en: [
    { qtype: 'number', md: '## How old are you?', id: 'age', required: true },
    { qtype: 'short', md: '## Where were you born?', placeholder: 'City, country', id: 'birthplace' },
    { qtype: 'short', md: '## Where did you grow up?', placeholder: 'City, country', id: 'grew_up' },
    { qtype: 'single', md: '## Which language did you learn first at home?', options: ['English', 'Spanish', 'Both'], other: true, id: 'first_language' },
    { qtype: 'multiple', md: '## Which languages do you speak?', options: ['English', 'Spanish', 'French', 'Portuguese'], other: true, id: 'languages' },
    { qtype: 'single', md: '## What is the highest level of education you have completed?', options: ['Primary school', 'Secondary school', 'Vocational training', 'University degree', 'Postgraduate degree'], id: 'education' },
    { qtype: 'long', md: '## Is there anything else about your languages you would like to tell us?', id: 'comments' },
  ],
  es: [
    { qtype: 'number', md: '## ¿Cuántos años tienes?', id: 'edad', required: true },
    { qtype: 'short', md: '## ¿Dónde naciste?', placeholder: 'Ciudad, país', id: 'lugar_nacimiento' },
    { qtype: 'short', md: '## ¿Dónde creciste?', placeholder: 'Ciudad, país', id: 'lugar_crianza' },
    { qtype: 'single', md: '## ¿Qué lengua aprendiste primero en casa?', options: ['Español', 'Inglés', 'Las dos'], other: true, id: 'primera_lengua' },
    { qtype: 'multiple', md: '## ¿Qué lenguas hablas?', options: ['Español', 'Inglés', 'Catalán', 'Euskera', 'Gallego'], other: true, id: 'lenguas' },
    { qtype: 'single', md: '## ¿Cuál es el nivel de estudios más alto que has completado?', options: ['Educación primaria', 'Educación secundaria', 'Formación profesional', 'Grado universitario', 'Posgrado'], id: 'estudios' },
    { qtype: 'long', md: '## ¿Quieres contarnos algo más sobre las lenguas que hablas?', id: 'comentarios' },
  ],
};

function addBackgroundQuestions(t) {
  const list = BACKGROUND[draft.language] || BACKGROUND.en;
  for (const q of list) {
    const s = { uid: uid(), kind: 'question', options: [], other: false, required: false, placeholder: '', ...q, label: plainText(q.md) };
    s.id = uniqueId(t, q.id, s);
    t.slides.push(s);
  }
  markDirty(); render();
  A.toast(`Added ${list.length} questions: edit or delete the ones you don’t need`);
}

async function editQuestion(t, slide, defaultType = 'short') {
  const isNew = !slide;
  const s = slide ? { ...slide, options: [...(slide.options || [])] } : { uid: uid(), kind: 'question', qtype: defaultType, md: '', options: [], other: false, required: false, placeholder: '', id: '', label: '' };
  const texts = QUESTION_TEXT[draft.language] || QUESTION_TEXT.en;
  const m = document.createElement('div');
  m.className = 'modal-back';
  m.innerHTML = `<div class="modal wide edit-slide"><h3>${isNew ? 'New question' : 'Edit question'}</h3>
    <div class="es-cols">
      <div class="es-form">
        <label class="field"><span>Question</span><textarea id="eq-md" rows="3" placeholder="## Where were you born?">${esc(s.md)}</textarea>
          <small>Start with <code>##</code> to show it as a heading. A blank line starts a new paragraph.</small></label>
        <label class="field"><span>Type of answer</span><select id="eq-type">${Object.entries(QUESTION_TYPES).map(([k, l]) => `<option value="${k}" ${s.qtype === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field eq-choice"><span>Options, one per line</span><textarea id="eq-opts" rows="5" placeholder="Spanish&#10;English&#10;Both">${esc(s.options.join('\n'))}</textarea></label>
        <label class="check eq-choice"><input type="checkbox" id="eq-other" ${s.other ? 'checked' : ''}> <span>Add “${esc(texts.other)}” with a box to type in</span></label>
        <label class="field eq-text"><span>Hint inside the answer box <em>(optional)</em></span><input id="eq-ph" value="${esc(s.placeholder || '')}" placeholder="${esc(texts.typeHere)}"></label>
        <label class="check"><input type="checkbox" id="eq-req" ${s.required ? 'checked' : ''}> <span>Required: the participant can’t continue without answering</span></label>
        <label class="field"><span>Item ID</span><input id="eq-id" value="${esc(s.id)}" placeholder="automatic"><small>The column name in responses.csv. Letters, numbers and _ only.</small></label>
      </div>
      <div class="es-preview"><span class="muted small">Preview (you can try it)</span><div class="thumb-in big q-preview" id="eq-prev"></div></div>
    </div>
    <div class="modal-actions"><button class="btn ghost" data-r="0">Cancel</button><button class="btn primary" data-r="1">${isNew ? 'Add question' : 'Save question'}</button></div></div>`;
  document.body.appendChild(m);
  const $m = (sel) => m.querySelector(sel);
  const refresh = () => {
    const choice = s.qtype === 'single' || s.qtype === 'multiple';
    m.querySelectorAll('.eq-choice').forEach((el) => { el.hidden = !choice; });
    m.querySelectorAll('.eq-text').forEach((el) => { el.hidden = choice; });
    $m('#eq-prev').innerHTML = renderSlide({ ...s, md: s.md || '## …' }, resolve, { interactive: true, texts });
  };
  $m('#eq-md').addEventListener('input', (e) => { s.md = e.target.value; refresh(); });
  $m('#eq-type').addEventListener('change', (e) => { s.qtype = e.target.value; refresh(); });
  $m('#eq-opts').addEventListener('input', (e) => { s.options = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); refresh(); });
  $m('#eq-other').addEventListener('change', (e) => { s.other = e.target.checked; refresh(); });
  $m('#eq-ph').addEventListener('input', (e) => { s.placeholder = e.target.value; refresh(); });
  $m('#eq-req').addEventListener('change', (e) => { s.required = e.target.checked; refresh(); });
  refresh();
  setTimeout(() => $m('#eq-md').focus(), 50);
  while (true) {
    const ok = await new Promise((r) => { const h = (e) => { const b = e.target.closest('[data-r]'); if (b) { m.removeEventListener('click', h); r(b.dataset.r === '1'); } }; m.addEventListener('click', h); });
    if (!ok) { m.remove(); return; }
    const choice = s.qtype === 'single' || s.qtype === 'multiple';
    if (!s.md.trim()) { A.toast('Write the question first', 'err'); continue; }
    if (choice && s.options.length < (s.other ? 1 : 2)) { A.toast('Add at least two options (one per line)', 'err'); continue; }
    break;
  }
  const idVal = $m('#eq-id').value;
  m.remove();
  if (!(s.qtype === 'single' || s.qtype === 'multiple')) { s.options = []; s.other = false; } else s.placeholder = '';
  s.label = plainText(s.md).slice(0, 120);
  s.id = uniqueId(t, idVal || s.label, slide || s);
  if (isNew) t.slides.push(s); else Object.assign(slide, s);
  markDirty(); render();
}

// ---------- saving ----------
function buildJson() {
  const names = new Set();
  const tasks = draft.tasks.filter((t) => t.slides.length).map((t, i) => {
    let name = slugify(t.label, 30) || `task${i + 1}`, n = 2;
    while (names.has(name)) name = `${slugify(t.label, 26) || 'task'}_${n++}`;
    names.add(name);
    return {
      task: name, label: t.label || `Task ${i + 1}`, preset: t.preset || '', recording: t.recording, randomize: t.randomize || false,
      repetitions: t.repetitions || 1, instructions: t.instructions || '',
      slides: t.slides.map(({ uid: _u, ...s }) => s),
    };
  });
  return { fieldrec: 1, title: draft.title.trim() || 'Untitled protocol', language: draft.language, author: draft.author || '', consent: draft.consent || '', tasks };
}
function usedAssets(json) {
  const used = new Set();
  const proto = { consent: json.consent, tasks: json.tasks.map((t) => ({ slides: t.slides })) };
  for (const p of referencedImages(proto)) used.add(A.normPath(p));
  const out = {};
  for (const p of used) { const a = assets.get(p) || [...assets.entries()].find(([k]) => k.split('/').pop().toLowerCase() === p.split('/').pop().toLowerCase())?.[1]; if (a) out[p] = a; }
  return out;
}

async function save() {
  const json = buildJson();
  if (!json.tasks.length) { A.toast('Add at least one task with slides before saving', 'err'); return null; }
  const empty = draft.tasks.filter((t) => !t.slides.length).length;
  const media = usedAssets(json);
  // Safety net: anything referenced but not in memory is taken from the version already saved
  const wanted = new Set(referencedImages({ consent: json.consent, tasks: json.tasks }).map((p) => A.normPath(p)));
  const lacking = [...wanted].filter((p) => !media[p]);
  if (lacking.length && recId) {
    try {
      const old = await A.db.get('protocols', recId);
      if (old) for (const p of lacking) {
        const v = old.files[p] || Object.entries(old.files).find(([k]) => k.split('/').pop().toLowerCase() === p.split('/').pop().toLowerCase())?.[1];
        const data = v instanceof Blob ? await v.arrayBuffer() : v && v.data;
        if (data) { media[p] = { type: (v && v.type) || A.guessType(p), data }; assets.set(p, media[p]); }
      }
    } catch (_) {}
  }
  const stillMissing = [...wanted].filter((p) => !media[p]).length;
  if (stillMissing && !(await A.modal({ title: `${stillMissing} pictures are missing`, body: '<p>Those slides will show an empty frame. You can restore the pictures first (see the warning at the top of the editor) or save anyway.</p>', ok: 'Save anyway', cancel: 'Cancel' }))) return null;
  const files = { 'protocol.json': { type: 'application/json', data: new TextEncoder().encode(JSON.stringify(json, null, 1)).buffer }, ...media };
  const now = new Date().toISOString();
  const rec = { id: recId || 'imp:' + A.uuid(), title: json.title, mainName: 'protocol.json', files, importedAt: recCreated || now, updatedAt: now, editor: true };
  try {
    await A.db.put('protocols', rec);
  } catch (err) {
    A.modal({ title: 'Couldn’t save', body: `<p>${esc(err.message)}</p><p>The device may be out of storage.</p>`, cancel: '', ok: 'OK' });
    return null;
  }
  await A.db.audit(recId ? 'protocol_updated' : 'protocol_created', { protocol: json.title, files: Object.keys(files).length });
  recId = rec.id; recCreated = rec.importedAt; sourceFormat = 'json';
  dirty = false;
  render();
  const d = document.getElementById('ed-dirty'); if (d) d.textContent = 'Saved';
  A.toast(empty ? `Saved (${empty} empty ${empty === 1 ? 'task was' : 'tasks were'} left out)` : 'Protocol saved');
  return rec.id;
}

async function downloadZip() {
  const json = buildJson();
  if (!json.tasks.length) return A.toast('Add at least one task with slides first', 'err');
  const folder = slugify(json.title, 40) || 'protocol';
  const entries = [{ name: `${folder}/protocol.json`, data: JSON.stringify(json, null, 1) }];
  for (const [p, a] of Object.entries(usedAssets(json))) entries.push({ name: `${folder}/${p}`, data: a.data });
  const blob = await A.makeZip(entries);
  A.downloadBlob(new File([blob], `${folder}.zip`, { type: 'application/zip' }), `${folder}.zip`);
}

export function editorIsDirty() { return dirty; }
export { renderMarkdown };
