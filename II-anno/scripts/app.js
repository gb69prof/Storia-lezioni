import { put, get, getAll, remove, clearStore } from './db.js';
import { PART_1 } from '../data/manuale-part-1.js';
import { PART_2 } from '../data/manuale-part-2.js';
import { PART_3 } from '../data/manuale-part-3.js';
import { PART_4 } from '../data/manuale-part-4.js';
const MANUAL_GZIP_BASE64 = PART_1 + PART_2 + PART_3 + PART_4;

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const settingsDialog = document.querySelector('#settingsDialog');
const noteDialog = document.querySelector('#noteDialog');
const imageDialog = document.querySelector('#imageDialog');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let manual;
let suppliedMaps = {}; // reserved for optional author maps
let lessonIndex = new Map();
let moduleIndex = new Map();
let timer = null;
let lastActive = Date.now();
let deferredInstall = null;
let selectionSnapshot = null;
let activeHighlight = null;
let currentLesson = null;
let selectionListener = null;
let lessonClickListener = null;
let quickNoteTimer = null;

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escXml = esc;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const formatMinutes = seconds => Math.max(0, Math.round((seconds || 0) / 60));
const stripNumber = value => String(value).replace(/^\s*\d+[.)]\s*/, '');

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._hide);
  toastEl._hide = setTimeout(() => toastEl.classList.remove('show'), 2300);
}


async function loadManualData() {
  const binary = atob(MANUAL_GZIP_BASE64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!('DecompressionStream' in window)) {
    throw new Error('Questo browser non supporta la decompressione dei contenuti. Aggiorna Safari o usa una versione recente del browser.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Impossibile caricare ${path} (${response.status}).`);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error(`${path} non contiene dati JSON validi.`);
  return response.json();
}

function showFatal(error) {
  console.error(error);
  app.innerHTML = `<section class="error-screen"><div class="eyebrow">Errore di avvio</div><h1>Il manuale non può essere caricato</h1><p>${esc(error.message || error)}</p><p>Ricarica la pagina. Se l'errore continua, elimina i dati del sito <strong>gb69prof.github.io</strong> dalle impostazioni di Safari e riapri l'app.</p><button class="primary" id="reloadApp">Ricarica</button></section>`;
  $('#reloadApp')?.addEventListener('click', () => location.reload());
}

function navigate(path) {
  location.hash = path;
}

function parseRoute() {
  const raw = (location.hash || '#/').slice(1);
  return raw.split('/').filter(Boolean).map(decodeURIComponent);
}

function stopLessonRuntime() {
  if (timer) clearInterval(timer);
  timer = null;
  if (selectionListener) document.removeEventListener('selectionchange', selectionListener);
  selectionListener = null;
  if (lessonClickListener) app.removeEventListener('click', lessonClickListener);
  lessonClickListener = null;
  currentLesson = null;
  selectionSnapshot = null;
  activeHighlight = null;
  clearTimeout(quickNoteTimer);
}

async function route() {
  stopLessonRuntime();
  const parts = parseRoute();
  window.scrollTo({ top: 0, behavior: 'auto' });
  try {
    if (!parts.length) await renderHome();
    else if (parts[0] === 'modules') await renderModules();
    else if (parts[0] === 'module') await renderModule(parts[1]);
    else if (parts[0] === 'lesson') await renderLesson(parts[1], parts[2] === 'block' ? parts[3] : null);
    else if (parts[0] === 'quiz') await renderQuiz(parts[1]);
    else if (parts[0] === 'report') await renderReport(parts[1]);
    else if (parts[0] === 'notes') await renderNotes(parts[1] || null);
    else if (parts[0] === 'search') await renderSearch();
    else if (parts[0] === 'progress') await renderProgress();
    else await renderHome();
    app.focus({ preventScroll: true });
  } catch (error) {
    showFatal(error);
  }
}

async function progressFor(lessonId) {
  return await get('progress', lessonId) || { id: lessonId, state: 'Non iniziata', percent: 0, seconds: 0, updated: 0 };
}

async function saveProgress(lessonId, patch) {
  const old = await progressFor(lessonId);
  const value = { ...old, ...patch, id: lessonId, updated: Date.now() };
  await put('progress', value);
  return value;
}

function stateClass(state) {
  if (state === 'Consolidata') return 'done';
  if (state === 'Da recuperare') return 'recover';
  return '';
}

async function allStats() {
  const progress = await getAll('progress');
  const notes = await getAll('notes');
  const totalSeconds = progress.reduce((sum, item) => sum + (item.seconds || 0), 0);
  const completed = progress.filter(item => item.state === 'Consolidata').length;
  const started = progress.filter(item => item.state !== 'Non iniziata').length;
  return { progress, notes, totalSeconds, completed, started };
}

async function renderHome() {
  const stats = await allStats();
  const settings = await get('settings', 'lastLesson');
  const last = settings?.value ? lessonIndex.get(settings.value) : null;
  const overall = Math.round((stats.completed / manual.lessons.length) * 100);
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Manuale Vivo · Secondo anno</div>
        <h1>La storia come processo, non come deposito di date.</h1>
        <p class="lead">${esc(manual.description)}</p>
        <div class="button-row">
          <a class="button primary" href="${last ? `#/lesson/${last.id}` : `#/module/${manual.modules[0].id}`}">${last ? `Continua: ${esc(last.title)}` : 'Inizia il percorso'}</a>
          <a class="button secondary" href="#/modules">Esplora i quattro percorsi</a>
        </div>
      </div>
      <aside class="hero-panel">
        <div class="eyebrow">Il tuo studio</div>
        <h2>${overall}% completato</h2>
        <div class="progress-track" aria-label="Avanzamento complessivo"><span style="width:${overall}%"></span></div>
        <div class="metrics">
          <div class="metric"><strong>${stats.completed}</strong><span>lezioni consolidate</span></div>
          <div class="metric"><strong>${formatMinutes(stats.totalSeconds)}</strong><span>minuti di studio</span></div>
          <div class="metric"><strong>${stats.notes.length}</strong><span>appunti salvati</span></div>
        </div>
        <p class="muted">I dati restano sul dispositivo. Dalla sezione Appunti puoi esportarli.</p>
      </aside>
    </section>
    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Percorsi</div><h2>Dalla Repubblica a Carlo Magno</h2></div><a href="#/modules">Vedi tutte le lezioni</a></div>
      <div class="module-grid">${await moduleCards()}</div>
    </section>`;
}

async function moduleCards() {
  const progress = await getAll('progress');
  const pmap = new Map(progress.map(p => [p.id, p]));
  return manual.modules.map((module, index) => {
    const done = module.lessons.filter(id => pmap.get(id)?.state === 'Consolidata').length;
    const percent = Math.round((done / module.lessons.length) * 100);
    return `<article class="card module-card">
      <div class="module-number">0${index + 1}</div>
      <div class="eyebrow">${esc(module.period)}</div>
      <h3>${esc(module.title)}</h3>
      <p>${esc(module.description)}</p>
      <div class="progress-track"><span style="width:${percent}%"></span></div>
      <p class="muted">${done} di ${module.lessons.length} consolidate</p>
      <a class="button" href="#/module/${module.id}">Apri il percorso</a>
    </article>`;
  }).join('');
}

async function renderModules() {
  app.innerHTML = `<section class="section"><div class="eyebrow">Indice generale</div><h1>I quattro percorsi</h1><p class="lead">Ogni percorso conserva una propria domanda storica, ma tutti mostrano come il potere romano si trasformò nel tempo.</p><div class="module-grid">${await moduleCards()}</div></section>`;
}

async function renderModule(moduleId) {
  const module = moduleIndex.get(moduleId);
  if (!module) return renderModules();
  const progresses = await getAll('progress');
  const pmap = new Map(progresses.map(p => [p.id, p]));
  const lessons = module.lessons.map(id => lessonIndex.get(id));
  app.innerHTML = `<section class="section">
    <div class="eyebrow">${esc(module.period)}</div><h1>${esc(module.title)}</h1><p class="lead">${esc(module.description)}</p>
    <div class="lesson-grid">${lessons.map((lesson, index) => {
      const p = pmap.get(lesson.id) || { state: 'Non iniziata', percent: 0 };
      return `<article class="card lesson-card">
        <span class="lesson-index">${index + 1}</span>
        <div><h3><a href="#/lesson/${lesson.id}">${esc(lesson.title)}</a></h3><p class="muted">${esc(lesson.problem)}</p><div class="progress-track"><span style="width:${p.percent || 0}%"></span></div></div>
        <span class="status-pill"><i class="state-dot ${stateClass(p.state)}"></i>${esc(p.state)}</span>
      </article>`;
    }).join('')}</div>
  </section>`;
}

function uniqueHeadings(lesson) {
  const seen = new Set();
  return lesson.blocks.filter(block => block.heading && !seen.has(block.heading) && seen.add(block.heading));
}

function lessonNav(lesson) {
  const headings = uniqueHeadings(lesson).map(block => `<a href="#${block.id}" data-scroll-target="${block.id}">${esc(block.heading)}</a>`).join('');
  return `<aside class="lesson-nav" aria-label="Indice della lezione">
    <div class="eyebrow">In questa lezione</div>
    <a href="#lesson-top" data-scroll-target="lesson-top">Il problema</a>${headings}
    <a href="#schema" data-scroll-target="schema">Schema</a>
    <a href="#mappa" data-scroll-target="mappa">Mappa concettuale</a>
    <a href="#saperi" data-scroll-target="saperi">Saperi irrinunciabili</a>
    <a href="#sintesi" data-scroll-target="sintesi">Sintesi</a>
    <a href="#/quiz/${lesson.id}">Test finale</a>
  </aside>`;
}

function wrapSvgText(text, max = 34) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function conceptMap(lesson) {
  const steps = (lesson.schema.length ? lesson.schema : lesson.essentials).slice(0, 8);
  const width = 960, boxW = 340, boxH = 72, gap = 25, startY = 125;
  const height = startY + steps.length * (boxH + gap) + 55;
  const colors = ['#8a4b32','#3f6a65','#856b2f','#5f557e'];
  const nodes = steps.map((step, i) => {
    const x = i % 2 === 0 ? 105 : 515;
    const y = startY + i * (boxH + gap);
    const lines = wrapSvgText(step, 38);
    const tspans = lines.map((line, n) => `<tspan x="${x + boxW/2}" dy="${n === 0 ? 0 : 18}">${escXml(line)}</tspan>`).join('');
    const arrow = i < steps.length - 1 ? `<path d="M${x + boxW/2} ${y + boxH} C${x + boxW/2} ${y + boxH + 35}, ${i % 2 === 0 ? 685 : 275} ${y + boxH + 35}, ${i % 2 === 0 ? 685 : 275} ${y + boxH + gap}" fill="none" stroke="#6d5f4e" stroke-width="3" marker-end="url(#arrow)"/>` : '';
    return `<g><rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="18" fill="#fffaf0" stroke="${colors[i % colors.length]}" stroke-width="4"/><circle cx="${x + 26}" cy="${y + 26}" r="17" fill="${colors[i % colors.length]}"/><text x="${x + 26}" y="${y + 32}" text-anchor="middle" fill="#fff" font-size="16" font-family="Arial">${i + 1}</text><text x="${x + boxW/2}" y="${y + 27 - (lines.length-1)*7}" text-anchor="middle" fill="#27231d" font-size="16" font-family="Georgia,serif">${tspans}</text>${arrow}</g>`;
  }).join('');
  return `<svg class="concept-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mappa concettuale della lezione ${esc(lesson.title)}"><defs><pattern id="paper" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#efe2c8"/><path d="M0 12h80M0 47h80" stroke="#dcc9a6" stroke-width=".6" opacity=".45"/></pattern><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#6d5f4e"/></marker></defs><rect width="100%" height="100%" fill="url(#paper)"/><text x="480" y="55" text-anchor="middle" fill="#27231d" font-size="29" font-family="Georgia,serif" font-weight="700">${escXml(lesson.title)}</text><text x="480" y="86" text-anchor="middle" fill="#8a4b32" font-size="15" font-family="Arial" letter-spacing="2">MAPPA DEL PROCESSO STORICO</text>${nodes}</svg>`;
}

function studyDock(lesson) {
  return `<aside class="study-dock" id="studyDock" aria-label="Strumenti di studio">
    <button class="dock-toggle" id="dockToggle" type="button">✦ Strumenti di studio</button>
    <div class="dock-details">
      <div class="eyebrow">Testo selezionato</div>
      <div id="selectionPreview" class="selection-preview">Seleziona una frase della lezione. I comandi resteranno qui, senza coprire il testo.</div>
      <div class="color-row" aria-label="Colore evidenziazione">
        <button class="color-chip active" data-highlight-color="yellow" aria-label="Giallo"></button>
        <button class="color-chip" data-highlight-color="green" aria-label="Verde"></button>
        <button class="color-chip" data-highlight-color="blue" aria-label="Azzurro"></button>
        <button class="color-chip" data-highlight-color="pink" aria-label="Rosa"></button>
      </div>
      <div class="dock-actions">
        <button type="button" data-study-action="highlight" disabled>◆ Evidenzia</button>
        <button type="button" data-study-action="copy" disabled>＋ Negli appunti</button>
        <button type="button" data-study-action="note" disabled>✎ Aggiungi nota</button>
        <button type="button" data-study-action="remove" disabled>× Rimuovi</button>
      </div>
      <div class="quick-note">
        <label>Appunto rapido<textarea id="quickNote" placeholder="Scrivi un pensiero sulla lezione…"></textarea></label>
        <button class="primary" id="saveQuickNote" type="button">Salva appunto</button>
      </div>
      <p><a href="#/notes/${lesson.id}">Apri tutti gli appunti →</a></p>
    </div>
  </aside>`;
}

async function renderLesson(lessonId, targetBlock = null) {
  const lesson = lessonIndex.get(lessonId);
  if (!lesson) return renderModules();
  currentLesson = lesson;
  await put('settings', { id: 'lastLesson', value: lesson.id });
  const p = await progressFor(lesson.id);
  if (p.state === 'Non iniziata') await saveProgress(lesson.id, { state: 'In lettura', percent: Math.max(5, p.percent) });
  const mapImage = lesson.mapKey ? suppliedMaps[lesson.mapKey] : null;
  app.innerHTML = `<div class="lesson-shell">
    ${lessonNav(lesson)}
    <article class="reader" id="lesson-top">
      <header class="reader-header">
        <div class="eyebrow">${esc(moduleIndex.get(lesson.moduleId).title)} · ${esc(lesson.period)}</div>
        <h1>${esc(lesson.title)}</h1>
        ${lesson.subtitle ? `<p class="lead">${esc(lesson.subtitle)}</p>` : ''}
        <p>${esc(lesson.intro)}</p>
      </header>
      <section class="problem-card"><strong>Il problema da risolvere</strong><p>${esc(lesson.problem)}</p></section>
      <section aria-label="Lezione">${lesson.blocks.map(block => `<section class="study-block" id="${block.id}" data-study-block="${block.id}">${block.heading ? `<h2>${esc(block.heading)}</h2>` : ''}<p data-original-text="${esc(block.text)}">${esc(block.text)}</p></section>`).join('')}</section>
      <section class="tools-section" id="schema"><div class="eyebrow">Organizzazione</div><h2>Schema del processo storico</h2><div class="flow">${lesson.schema.map(step => `<div class="flow-step">${esc(step)}</div>`).join('')}</div></section>
      <section class="tools-section" id="mappa"><div class="eyebrow">Memorizzazione visiva</div><h2>Mappa concettuale</h2><div class="map-grid"><div class="concept-wrap">${conceptMap(lesson)}</div>${mapImage ? `<div><h3>Mappa d'autore</h3><img class="author-map" src="${mapImage}" alt="Mappa concettuale illustrata dedicata a ${esc(lesson.mapKey)}" data-large-map="${lesson.mapKey}"></div>` : ''}</div></section>
      <section class="tools-section" id="saperi"><div class="eyebrow">Memorizzazione</div><h2>Saperi irrinunciabili</h2><div class="essential-grid">${lesson.essentials.map((item, i) => `<div class="essential"><b>${i + 1}</b><span>${esc(item)}</span></div>`).join('')}</div></section>
      <section class="tools-section"><div class="eyebrow">Lessico</div><h2>Vocabolario essenziale</h2><table class="glossary"><tbody>${lesson.glossary.map(([term, meaning]) => `<tr><th>${esc(term)}</th><td>${esc(meaning)}</td></tr>`).join('')}</tbody></table></section>
      <section class="tools-section" id="sintesi"><div class="eyebrow">Sintesi</div><h2>Il nucleo della lezione</h2><div class="summary-card">${esc(lesson.summary)}</div>${lesson.openQuestions.length ? `<details class="card"><summary><strong>Domande aperte di comprensione</strong></summary><ol>${lesson.openQuestions.map(q => `<li>${esc(stripNumber(q))}</li>`).join('')}</ol></details>` : ''}<div class="button-row"><a class="button primary" href="#/quiz/${lesson.id}">Avvia il test finale</a><a class="button" href="#/module/${lesson.moduleId}">Torna al percorso</a></div></section>
    </article>
    ${studyDock(lesson)}
  </div>`;
  bindLessonInteractions(lesson);
  await applyAllHighlights(lesson);
  startLessonTimer(lesson);
  const pos = targetBlock || (await get('positions', lesson.id))?.blockId;
  if (pos) setTimeout(() => document.getElementById(pos)?.scrollIntoView({ block: 'start' }), 100);
}

function getOffsetWithin(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); } catch { return 0; }
  return range.toString().length;
}

function updateDockState() {
  const preview = $('#selectionPreview');
  if (!preview) return;
  const usable = Boolean(selectionSnapshot?.text);
  const removable = Boolean(activeHighlight?.id);
  preview.textContent = removable ? `Evidenziazione: “${activeHighlight.text}”` : usable ? `“${selectionSnapshot.text}”` : 'Seleziona una frase della lezione. I comandi resteranno qui, senza coprire il testo.';
  $$('[data-study-action="highlight"],[data-study-action="copy"],[data-study-action="note"]').forEach(button => button.disabled = !usable);
  $('[data-study-action="remove"]').disabled = !removable;
}

function captureSelection() {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const anchor = selection.anchorNode?.parentElement?.closest?.('[data-study-block]');
  const focus = selection.focusNode?.parentElement?.closest?.('[data-study-block]');
  if (!anchor || !focus || anchor !== focus) {
    selectionSnapshot = null;
    const preview = $('#selectionPreview');
    if (preview) preview.textContent = 'Per un salvataggio preciso, seleziona il testo all’interno di un solo paragrafo.';
    updateDockState();
    return;
  }
  const paragraph = anchor.querySelector('p');
  const range = selection.getRangeAt(0);
  let start = getOffsetWithin(paragraph, range.startContainer, range.startOffset);
  let end = getOffsetWithin(paragraph, range.endContainer, range.endOffset);
  if (start > end) [start, end] = [end, start];
  const text = paragraph.textContent.slice(start, end).trim();
  if (!text) return;
  selectionSnapshot = { lessonId: currentLesson.id, blockId: anchor.dataset.studyBlock, start, end, text };
  activeHighlight = null;
  updateDockState();
  $('#studyDock')?.classList.add('open');
}

async function applyAllHighlights(lesson) {
  const all = (await getAll('highlights')).filter(h => h.lessonId === lesson.id);
  for (const block of lesson.blocks) renderBlockHighlights(block, all.filter(h => h.blockId === block.id));
}

function renderBlockHighlights(block, highlights) {
  const p = document.querySelector(`[data-study-block="${block.id}"] p`);
  if (!p) return;
  const text = block.text;
  const valid = highlights.filter(h => h.start >= 0 && h.end <= text.length && h.start < h.end).sort((a,b) => a.start - b.start);
  let cursor = 0; let html = '';
  for (const h of valid) {
    if (h.start < cursor) continue;
    html += esc(text.slice(cursor, h.start));
    html += `<mark class="hl-${h.color}" data-highlight-id="${h.id}" title="Tocca per gestire questa evidenziazione">${esc(text.slice(h.start, h.end))}</mark>`;
    cursor = h.end;
  }
  html += esc(text.slice(cursor));
  p.innerHTML = html;
}

async function addHighlight(color) {
  if (!selectionSnapshot) return toast('Seleziona prima una frase.');
  const all = (await getAll('highlights')).filter(h => h.lessonId === currentLesson.id && h.blockId === selectionSnapshot.blockId);
  const overlaps = all.some(h => selectionSnapshot.start < h.end && selectionSnapshot.end > h.start);
  if (overlaps) return toast('La selezione comprende già un testo evidenziato.');
  const item = { id: uid(), ...selectionSnapshot, color, created: Date.now() };
  await put('highlights', item);
  renderBlockHighlights(currentLesson.blocks.find(b => b.id === item.blockId), [...all, item]);
  getSelection()?.removeAllRanges();
  selectionSnapshot = null;
  updateDockState();
  toast('Evidenziazione salvata.');
}

async function createNoteFromSelection(withDialog = false) {
  if (!selectionSnapshot) return toast('Seleziona prima una frase.');
  if (withDialog) {
    $('#noteQuote').textContent = selectionSnapshot.text;
    $('#dialogNoteTitle').value = selectionSnapshot.text.slice(0, 58);
    $('#dialogNoteBody').value = '';
    noteDialog.showModal();
    return;
  }
  await put('notes', {
    id: uid(), title: selectionSnapshot.text.slice(0, 58), body: selectionSnapshot.text,
    quote: selectionSnapshot.text, lessonId: currentLesson.id, blockId: selectionSnapshot.blockId,
    folder: moduleIndex.get(currentLesson.moduleId).title, created: Date.now(), updated: Date.now(), order: Date.now()
  });
  toast('Testo copiato negli appunti.');
}

async function removeActiveHighlight() {
  if (!activeHighlight) return;
  const blockId = activeHighlight.blockId;
  await remove('highlights', activeHighlight.id);
  const remaining = (await getAll('highlights')).filter(h => h.lessonId === currentLesson.id && h.blockId === blockId);
  renderBlockHighlights(currentLesson.blocks.find(b => b.id === blockId), remaining);
  activeHighlight = null;
  updateDockState();
  toast('Evidenziazione rimossa.');
}

function bindLessonInteractions(lesson) {
  $$('[data-scroll-target]').forEach(link => link.addEventListener('click', event => {
    const target = document.getElementById(link.dataset.scrollTarget);
    if (target) { event.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));
  $('#dockToggle')?.addEventListener('click', () => $('#studyDock').classList.toggle('open'));
  let selectedColor = 'yellow';
  $$('.color-chip').forEach(chip => chip.addEventListener('click', () => {
    selectedColor = chip.dataset.highlightColor;
    $$('.color-chip').forEach(c => c.classList.toggle('active', c === chip));
  }));
  selectionListener = () => setTimeout(captureSelection, 20);
  document.addEventListener('selectionchange', selectionListener);
  lessonClickListener = event => {
    const mark = event.target.closest('mark[data-highlight-id]');
    if (mark) {
      getAll('highlights').then(items => {
        activeHighlight = items.find(h => h.id === mark.dataset.highlightId) || null;
        selectionSnapshot = null; updateDockState(); $('#studyDock')?.classList.add('open');
      });
    }
    const action = event.target.closest('[data-study-action]')?.dataset.studyAction;
    if (action === 'highlight') addHighlight(selectedColor);
    if (action === 'copy') createNoteFromSelection(false);
    if (action === 'note') createNoteFromSelection(true);
    if (action === 'remove') removeActiveHighlight();
    const image = event.target.closest('[data-large-map]');
    if (image) { $('#largeMap').src = suppliedMaps[image.dataset.largeMap]; $('#largeMap').alt = image.alt; imageDialog.showModal(); }
  };
  app.addEventListener('click', lessonClickListener);
  $('#saveQuickNote')?.addEventListener('click', async () => {
    const body = $('#quickNote').value.trim();
    if (!body) return toast('Scrivi prima un appunto.');
    await put('notes', { id: uid(), title: `Appunto su ${lesson.title}`, body, quote: '', lessonId: lesson.id, blockId: '', folder: moduleIndex.get(lesson.moduleId).title, created: Date.now(), updated: Date.now(), order: Date.now() });
    $('#quickNote').value = '';
    toast('Appunto salvato.');
  });
  $('#dialogNoteSave').onclick = async event => {
    event.preventDefault();
    const title = $('#dialogNoteTitle').value.trim() || `Nota su ${lesson.title}`;
    const body = $('#dialogNoteBody').value.trim();
    await put('notes', { id: uid(), title, body, quote: selectionSnapshot?.text || '', lessonId: lesson.id, blockId: selectionSnapshot?.blockId || '', folder: moduleIndex.get(lesson.moduleId).title, created: Date.now(), updated: Date.now(), order: Date.now() });
    noteDialog.close(); toast('Nota salvata negli appunti.');
  };
  updateDockState();
}

function startLessonTimer(lesson) {
  let chunk = 0;
  const activity = () => lastActive = Date.now();
  ['pointerdown','keydown','scroll','touchstart'].forEach(type => window.addEventListener(type, activity, { passive: true, once: true }));
  timer = setInterval(async () => {
    if (document.hidden || Date.now() - lastActive > 90000) return;
    chunk += 1;
    if (chunk % 15 !== 0) return;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const readingPercent = clamp(Math.round(scrollY / maxScroll * 70), 5, 70);
    const old = await progressFor(lesson.id);
    await saveProgress(lesson.id, { seconds: (old.seconds || 0) + 15, percent: Math.max(old.percent || 0, readingPercent), state: old.state === 'Non iniziata' ? 'In lettura' : old.state });
    const visible = lesson.blocks.find(block => {
      const el = document.getElementById(block.id); return el && el.getBoundingClientRect().top >= 70;
    }) || lesson.blocks.at(-1);
    if (visible) await put('positions', { id: lesson.id, blockId: visible.id, updated: Date.now() });
  }, 1000);
}

async function renderQuiz(lessonId) {
  const lesson = lessonIndex.get(lessonId);
  if (!lesson) return renderModules();
  const questions = lesson.quiz;
  let index = 0;
  const answers = Array(questions.length).fill(null);
  const started = Date.now();
  const draw = () => {
    const q = questions[index];
    app.innerHTML = `<section class="quiz-wrap"><div class="eyebrow">${esc(lesson.title)} · domanda ${index + 1} di ${questions.length}</div><div class="quiz-progress"><div class="progress-track" style="flex:1"><span style="width:${((index + 1)/questions.length)*100}%"></span></div><strong>${index + 1}/${questions.length}</strong></div><h1 class="quiz-question">${esc(q.prompt)}</h1><div class="option-list">${q.options.map((option, i) => `<button class="quiz-option ${answers[index] === i ? 'selected' : ''}" data-option="${i}" type="button">${esc(option)}</button>`).join('')}</div><div class="button-row" style="margin-top:1rem"><button id="prevQuestion" ${index === 0 ? 'disabled' : ''}>Indietro</button><button id="nextQuestion" class="primary">${index === questions.length - 1 ? 'Consegna' : 'Avanti'}</button><a class="button" href="#/lesson/${lesson.id}">Esci dal test</a></div></section>`;
    $$('.quiz-option').forEach(button => button.addEventListener('click', () => { answers[index] = Number(button.dataset.option); draw(); }));
    $('#prevQuestion').onclick = () => { index -= 1; draw(); };
    $('#nextQuestion').onclick = async () => {
      if (answers[index] === null) return toast('Scegli una risposta prima di continuare.');
      if (index < questions.length - 1) { index += 1; draw(); return; }
      const score = answers.filter((answer, i) => answer === questions[i].correct).length;
      const attempt = { id: lesson.id, lessonId: lesson.id, answers, score, total: questions.length, seconds: Math.round((Date.now()-started)/1000), recovered: [], created: Date.now() };
      await put('attempts', attempt);
      const old = await progressFor(lesson.id);
      await saveProgress(lesson.id, { state: score === questions.length ? 'Consolidata' : 'Da recuperare', percent: score === questions.length ? 100 : Math.max(old.percent, 80) });
      navigate(`#/report/${lesson.id}`);
    };
  };
  draw();
}

async function renderReport(lessonId) {
  const lesson = lessonIndex.get(lessonId);
  const attempt = await get('attempts', lessonId);
  if (!lesson || !attempt) return renderQuiz(lessonId);
  const pct = Math.round(attempt.score / attempt.total * 100);
  const level = pct < 50 ? 'Da riprendere' : pct < 70 ? 'Comprensione parziale' : pct < 85 ? 'Comprensione adeguata' : pct < 100 ? 'Molto buona' : 'Concetto consolidato';
  const wrong = lesson.quiz.map((q, i) => ({ q, i, chosen: attempt.answers[i] })).filter(item => item.chosen !== item.q.correct);
  app.innerHTML = `<section class="quiz-wrap"><div class="eyebrow">Report finale · ${esc(lesson.title)}</div><h1>${level}</h1><div class="report-grid"><div class="card report-stat"><strong>${attempt.score}</strong>corrette</div><div class="card report-stat"><strong>${attempt.total-attempt.score}</strong>errori</div><div class="card report-stat"><strong>${pct}%</strong>risultato</div><div class="card report-stat"><strong>${Math.max(1,Math.round(attempt.seconds/60))}</strong>minuti</div></div>${wrong.length ? `<h2 style="margin-top:2rem">Recupera gli errori</h2>${wrong.map(({q,i,chosen}) => `<article class="recovery-card ${attempt.recovered.includes(i) ? 'recovered' : ''}" data-recovery="${i}"><h3>${esc(q.prompt)}</h3><p><strong>Hai scelto:</strong> ${esc(q.options[chosen])}</p><p><strong>Perché non funziona:</strong> ${esc(q.misconceptions[chosen])}</p><div class="summary-card"><strong>Mini-lezione</strong><br>${esc(q.explanation)}</div><p><a href="#/lesson/${lesson.id}/block/${q.blockId}">Rivedi il punto della lezione</a></p><label>Prova di nuovo<select class="recovery-select"><option value="">Scegli una risposta</option>${q.options.map((o,n) => `<option value="${n}">${esc(o)}</option>`).join('')}</select></label><button class="check-recovery" type="button">Controlla</button> <span class="recovery-feedback" role="status"></span></article>`).join('')}` : `<div class="summary-card" style="margin-top:1.5rem">Hai risposto correttamente a tutte le domande. La lezione è consolidata.</div>`}<div class="button-row"><a class="button" href="#/quiz/${lesson.id}">Ripeti il test</a><a class="button primary" href="#/module/${lesson.moduleId}">Continua il percorso</a></div></section>`;
  $$('.check-recovery').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-recovery]'); const idx = Number(card.dataset.recovery); const q = lesson.quiz[idx];
    const value = Number($('.recovery-select', card).value); const feedback = $('.recovery-feedback', card);
    if ($('.recovery-select', card).value === '') { feedback.textContent = ' Scegli una risposta.'; return; }
    if (value === q.correct) {
      feedback.textContent = ' Corretto: lacuna recuperata.'; feedback.className = 'recovery-feedback feedback-good'; card.classList.add('recovered');
      if (!attempt.recovered.includes(idx)) attempt.recovered.push(idx);
      await put('attempts', attempt);
      if (wrong.every(item => attempt.recovered.includes(item.i))) await saveProgress(lesson.id, { state: 'Consolidata', percent: 100 });
    } else { feedback.textContent = ' Non ancora. Rileggi la mini-lezione e ricostruisci il ragionamento.'; feedback.className = 'recovery-feedback feedback-bad'; }
  }));
}

async function renderNotes(filterLessonId = null) {
  let notes = await getAll('notes');
  notes.sort((a,b) => (b.order || b.updated || 0) - (a.order || a.updated || 0));
  if (filterLessonId) notes = notes.filter(n => n.lessonId === filterLessonId);
  const folders = [...new Set((await getAll('notes')).map(n => n.folder || 'Generali'))].sort();
  app.innerHTML = `<section class="section"><div class="section-head"><div><div class="eyebrow">Studio personale</div><h1>Appunti</h1></div><div class="button-row"><button id="newNote" class="primary">Nuovo</button><button id="exportMarkdown">Esporta Markdown</button><button id="exportJson">Backup JSON</button><button id="printNotes">Stampa</button></div></div><div class="notes-layout"><aside class="card"><label>Filtra<input id="notesSearch" type="search" placeholder="Cerca negli appunti"></label><div id="noteList" class="note-list">${notes.map(n => noteListItem(n)).join('') || '<p class="muted">Nessun appunto salvato.</p>'}</div></aside><section class="card"><div id="emptyEditor"><p class="muted">Seleziona un appunto o creane uno nuovo.</p></div><div id="noteEditor" class="is-hidden"><label>Titolo<input id="noteTitle" type="text"></label><label>Cartella<input id="noteFolder" list="folderList" type="text"><datalist id="folderList">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist></label><label>Testo<textarea id="noteBody" rows="16"></textarea></label><p id="noteSource" class="muted"></p><div class="editor-actions"><button id="saveNote" class="primary">Salva appunto</button><button id="deleteNote">Elimina</button><button id="moveUp">Sposta su</button><button id="moveDown">Sposta giù</button></div><p class="save-status" id="saveStatus"></p></div></section></div></section>`;
  let active = null;
  const allNotes = await getAll('notes');
  function selectNote(note) {
    active = note; $('#emptyEditor').classList.add('is-hidden'); $('#noteEditor').classList.remove('is-hidden');
    $('#noteTitle').value = note.title || ''; $('#noteFolder').value = note.folder || 'Generali'; $('#noteBody').value = note.body || '';
    const source = note.lessonId ? lessonIndex.get(note.lessonId) : null;
    $('#noteSource').innerHTML = source ? `Fonte: <a href="#/lesson/${source.id}${note.blockId ? `/block/${note.blockId}` : ''}">${esc(source.title)}</a>${note.quote ? ` · Citazione: “${esc(note.quote.slice(0,90))}${note.quote.length>90?'…':''}”` : ''}` : 'Appunto libero';
    $$('.note-item').forEach(el => el.classList.toggle('active', el.dataset.noteId === note.id));
  }
  async function saveActive() {
    if (!active) return;
    active.title = $('#noteTitle').value.trim() || 'Senza titolo'; active.folder = $('#noteFolder').value.trim() || 'Generali'; active.body = $('#noteBody').value; active.updated = Date.now(); active.order ??= Date.now();
    await put('notes', active); $('#saveStatus').textContent = `Salvato alle ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`; toast('Appunto salvato.');
  }
  $$('.note-item').forEach(item => item.addEventListener('click', () => selectNote(allNotes.find(n => n.id === item.dataset.noteId))));
  $('#newNote').onclick = () => selectNote({ id: uid(), title: '', body: '', folder: 'Generali', lessonId: '', blockId: '', quote: '', created: Date.now(), updated: Date.now(), order: Date.now() });
  $('#saveNote').onclick = saveActive;
  ['noteTitle','noteFolder','noteBody'].forEach(id => $('#'+id).addEventListener('input', () => { clearTimeout(quickNoteTimer); $('#saveStatus').textContent='Modifiche non ancora salvate'; quickNoteTimer=setTimeout(saveActive,1800); }));
  $('#deleteNote').onclick = async () => { if (!active || !confirm('Eliminare questo appunto?')) return; await remove('notes', active.id); renderNotes(filterLessonId); };
  $('#moveUp').onclick = async () => { if (!active) return; active.order = (active.order || Date.now()) + 100000; await put('notes', active); renderNotes(filterLessonId); };
  $('#moveDown').onclick = async () => { if (!active) return; active.order = (active.order || Date.now()) - 100000; await put('notes', active); renderNotes(filterLessonId); };
  $('#notesSearch').oninput = event => { const q=event.target.value.toLowerCase(); $$('.note-item').forEach(item => item.hidden=!item.textContent.toLowerCase().includes(q)); };
  $('#exportJson').onclick = () => downloadText('manuale-vivo-storia-II-backup.json', JSON.stringify(allNotes,null,2), 'application/json');
  $('#exportMarkdown').onclick = () => downloadText('manuale-vivo-storia-II-appunti.md', allNotes.map(n => `# ${n.title}\n\n**Cartella:** ${n.folder || 'Generali'}\n\n${n.quote ? `> ${n.quote}\n\n` : ''}${n.body || ''}`).join('\n\n---\n\n'), 'text/markdown');
  $('#printNotes').onclick = () => window.print();
}

function noteListItem(note) {
  return `<button class="note-item" data-note-id="${note.id}"><strong>${esc(note.title || 'Senza titolo')}</strong><small>${esc(note.folder || 'Generali')} · ${new Date(note.updated || note.created).toLocaleDateString('it-IT')}</small><span>${esc((note.body || note.quote || '').slice(0,90))}</span></button>`;
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function highlightedSnippet(text, query) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return esc(text.slice(0,220));
  const start = Math.max(0,i-70), end=Math.min(text.length,i+query.length+140);
  return `${start?'…':''}${esc(text.slice(start,i))}<mark>${esc(text.slice(i,i+query.length))}</mark>${esc(text.slice(i+query.length,end))}${end<text.length?'…':''}`;
}

async function renderSearch() {
  const notes = await getAll('notes');
  app.innerHTML = `<section class="section"><div class="eyebrow">Ricerca globale</div><h1>Cerca nel Manuale Vivo</h1><div class="search-box"><label for="globalSearch">Titolo, concetto, parola o appunto<input id="globalSearch" type="search" placeholder="Es. auctoritas, Adrianopoli, Carlo Magno"></label></div><div id="searchResults" class="search-results"><p class="muted">Scrivi almeno due caratteri.</p></div></section>`;
  $('#globalSearch').addEventListener('input', event => {
    const q=event.target.value.trim(); const target=$('#searchResults'); if(q.length<2){target.innerHTML='<p class="muted">Scrivi almeno due caratteri.</p>';return;}
    const hits=[];
    for(const lesson of manual.lessons){
      const fields=[['Titolo',lesson.title,lesson.blocks[0]?.id],['Problema',lesson.problem,lesson.blocks[0]?.id],['Sintesi',lesson.summary,lesson.blocks.at(-1)?.id]].filter(Boolean);
      for(const [kind,text,block] of fields){if(text.toLowerCase().includes(q.toLowerCase()))hits.push({kind,title:lesson.title,text,href:`#/lesson/${lesson.id}/block/${block}`});}
      for(const block of lesson.blocks){if(block.text.toLowerCase().includes(q.toLowerCase()))hits.push({kind:'Lezione',title:lesson.title,text:block.text,href:`#/lesson/${lesson.id}/block/${block.id}`});}
      for(const [term,meaning] of lesson.glossary){const text=`${term}: ${meaning}`;if(text.toLowerCase().includes(q.toLowerCase()))hits.push({kind:'Vocabolario',title:lesson.title,text,href:`#/lesson/${lesson.id}`});}
    }
    for(const note of notes){const text=`${note.title} ${note.body} ${note.quote}`;if(text.toLowerCase().includes(q.toLowerCase()))hits.push({kind:'Appunto',title:note.title,text,href:'#/notes'});}
    target.innerHTML=hits.length?hits.slice(0,80).map(hit=>`<article class="search-result"><div class="eyebrow">${hit.kind}</div><h3><a href="${hit.href}">${esc(hit.title)}</a></h3><p>${highlightedSnippet(hit.text,q)}</p></article>`).join(''):'<p>Nessun risultato.</p>';
  });
}

async function renderProgress() {
  const progress = await getAll('progress'); const pmap=new Map(progress.map(p=>[p.id,p])); const total=progress.reduce((s,p)=>s+(p.seconds||0),0); const done=progress.filter(p=>p.state==='Consolidata').length;
  app.innerHTML=`<section class="section"><div class="eyebrow">Dashboard personale</div><h1>I tuoi progressi</h1><div class="report-grid"><div class="card report-stat"><strong>${done}</strong>lezioni consolidate</div><div class="card report-stat"><strong>${manual.lessons.length-done}</strong>da completare</div><div class="card report-stat"><strong>${formatMinutes(total)}</strong>minuti di studio</div><div class="card report-stat"><strong>${Math.round(done/manual.lessons.length*100)}%</strong>avanzamento</div></div>${manual.modules.map(module=>`<section class="section"><h2>${esc(module.title)}</h2><div class="card"><table class="progress-table"><thead><tr><th>Lezione</th><th>Stato</th><th>Tempo</th><th>Avanzamento</th></tr></thead><tbody>${module.lessons.map(id=>{const l=lessonIndex.get(id),p=pmap.get(id)||{state:'Non iniziata',seconds:0,percent:0};return `<tr><td><a href="#/lesson/${id}">${esc(l.title)}</a></td><td><i class="state-dot ${stateClass(p.state)}"></i>${esc(p.state)}</td><td>${formatMinutes(p.seconds)} min</td><td>${p.percent||0}%</td></tr>`}).join('')}</tbody></table></div></section>`).join('')}</section>`;
}

function applySettings(settings) {
  document.body.classList.toggle('dark', settings.theme === 'dark');
  document.body.classList.toggle('high-contrast', Boolean(settings.highContrast));
  document.body.classList.toggle('reduce-motion', Boolean(settings.reduceMotion));
  document.documentElement.style.setProperty('--font-size', `${settings.fontSize || 18}px`);
  $('#fontSize').value=settings.fontSize||18; $('#highContrast').checked=Boolean(settings.highContrast); $('#reduceMotion').checked=Boolean(settings.reduceMotion);
}

async function loadSettings() {
  const saved=await get('settings','preferences');
  const settings=saved?.value||{theme:'light',fontSize:18,highContrast:false,reduceMotion:false};
  applySettings(settings); return settings;
}

async function saveSettingsPatch(patch) {
  const old=(await get('settings','preferences'))?.value||{}; const value={...old,...patch}; await put('settings',{id:'preferences',value}); applySettings(value);
}

function bindGlobalControls() {
  window.addEventListener('hashchange',route);
  $('#themeBtn').onclick=async()=>{const old=(await get('settings','preferences'))?.value||{};saveSettingsPatch({theme:old.theme==='dark'?'light':'dark'});};
  $('#settingsBtn').onclick=()=>settingsDialog.showModal();
  $('#fontSize').oninput=e=>saveSettingsPatch({fontSize:Number(e.target.value)});
  $('#highContrast').onchange=e=>saveSettingsPatch({highContrast:e.target.checked});
  $('#reduceMotion').onchange=e=>saveSettingsPatch({reduceMotion:e.target.checked});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('#installBtn').classList.remove('is-hidden');});
  $('#installBtn').onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('is-hidden');};
  ['pointerdown','keydown','scroll','touchstart'].forEach(type=>window.addEventListener(type,()=>lastActive=Date.now(),{passive:true}));
}

async function boot() {
  try {
    manual = await loadManualData();
    suppliedMaps = {};
    lessonIndex=new Map(manual.lessons.map(l=>[l.id,l])); moduleIndex=new Map(manual.modules.map(m=>[m.id,m]));
    await loadSettings(); bindGlobalControls();
    if('serviceWorker'in navigator){navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('Service Worker:',error));}
    await route();
  } catch(error){showFatal(error);}
}

boot();
