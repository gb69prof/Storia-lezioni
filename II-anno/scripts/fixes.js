import { PART_1 } from '../data/manuale-part-1.js';
import { PART_2 } from '../data/manuale-part-2.js';
import { PART_3 } from '../data/manuale-part-3.js';
import { PART_4 } from '../data/manuale-part-4.js';

const DB_NAME = 'manuale-vivo-storia-ii-db';
const DB_VERSION = 1;
const STORES = ['progress','positions','sessions','attempts','highlights','notes','settings'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let dbPromise;
let lessonIndex = new Map();
let moduleIndex = new Map();
let activeNoteId = null;
let noteDirty = false;
let noteSaveTimer = null;
let quickDraftTimer = null;
let activeHighlightId = null;
let zoom = 1;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Salvataggio locale non disponibile.'));
  });
  return dbPromise;
}

async function transaction(store, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || new Error(`Errore nel salvataggio: ${store}.`));
  });
}

const dbGet = async (store, id) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};
const dbAll = async store => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};
const dbPut = (store, value) => transaction(store, 'readwrite', objectStore => objectStore.put(value)).then(() => value);
const dbRemove = (store, id) => transaction(store, 'readwrite', objectStore => objectStore.delete(id));
const dbClear = store => transaction(store, 'readwrite', objectStore => objectStore.clear());

function showPatchToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._patchHide);
  toast._patchHide = setTimeout(() => toast.classList.remove('show'), 2500);
}

async function loadManualIndex() {
  try {
    const binary = atob(PART_1 + PART_2 + PART_3 + PART_4);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const manual = JSON.parse(await new Response(stream).text());
    lessonIndex = new Map(manual.lessons.map(lesson => [lesson.id, lesson]));
    moduleIndex = new Map(manual.modules.map(module => [module.id, module]));
  } catch (error) {
    console.warn('Indice supplementare:', error);
  }
}

const linkedNoteId = highlightId => `highlight-note:${highlightId}`;

async function ensureHighlightInNotes(highlight) {
  if (!highlight?.id || !highlight.text) return false;
  const id = linkedNoteId(highlight.id);
  if (await dbGet('notes', id)) return false;
  const notes = await dbAll('notes');
  const equivalent = notes.some(note => note.lessonId === highlight.lessonId && note.blockId === highlight.blockId && (note.quote === highlight.text || note.body === highlight.text));
  if (equivalent) return false;
  const lesson = lessonIndex.get(highlight.lessonId);
  const module = lesson ? moduleIndex.get(lesson.moduleId) : null;
  await dbPut('notes', {
    id,
    kind: 'highlight',
    highlightId: highlight.id,
    color: highlight.color || 'yellow',
    title: lesson ? `Evidenziazione · ${lesson.title}` : 'Evidenziazione salvata',
    body: highlight.text,
    quote: highlight.text,
    lessonId: highlight.lessonId || '',
    blockId: highlight.blockId || '',
    folder: module?.title || 'Evidenziazioni',
    created: highlight.created || Date.now(),
    updated: highlight.created || Date.now(),
    order: highlight.created || Date.now()
  });
  return true;
}

async function syncAllHighlights() {
  let changed = 0;
  for (const highlight of await dbAll('highlights')) if (await ensureHighlightInNotes(highlight)) changed += 1;
  return changed;
}

async function syncHighlightById(id) {
  const highlight = (await dbAll('highlights')).find(item => item.id === id);
  if (!highlight) return;
  if (await ensureHighlightInNotes(highlight)) {
    const status = $('#patchStudyStatus');
    if (status) status.textContent = 'Salvato: il testo evidenziato è disponibile anche negli Appunti.';
    showPatchToast('Evidenziazione salvata anche negli Appunti.');
  }
}

async function removeLinkedHighlightNote(id) {
  if (!id) return;
  const note = await dbGet('notes', linkedNoteId(id));
  if (!note) return;
  if (note.kind === 'highlight' && note.body === note.quote) await dbRemove('notes', note.id);
  else await dbPut('notes', { ...note, kind: 'note', highlightId: '', title: String(note.title || '').replace(/^Evidenziazione · /, 'Nota · '), updated: Date.now() });
}

function currentLessonId() {
  const match = location.hash.match(/^#\/lesson\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function setSaveStatus(text, error = false) {
  const status = $('#saveStatus');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('save-error', error);
}

function editorValues() {
  return {
    title: $('#noteTitle')?.value.trim() || 'Senza titolo',
    folder: $('#noteFolder')?.value.trim() || 'Generali',
    body: $('#noteBody')?.value || ''
  };
}

function refreshNoteItem(note) {
  const item = activeNoteId ? $(`[data-note-id="${CSS.escape(activeNoteId)}"]`) : null;
  if (!item) return;
  item.querySelector('strong')?.replaceChildren(document.createTextNode(note.title));
  const small = item.querySelector('small');
  if (small) small.textContent = `${note.folder} · ${new Date(note.updated).toLocaleDateString('it-IT')}`;
  const snippet = item.querySelector('.patch-note-snippet') || item.querySelector('span:last-child');
  if (snippet) snippet.textContent = note.body.slice(0, 90);
}

async function saveEditorNote(announce = false) {
  clearTimeout(noteSaveTimer);
  if (!activeNoteId || !$('#noteEditor') || $('#noteEditor').classList.contains('is-hidden')) return;
  const existing = await dbGet('notes', activeNoteId) || {
    id: activeNoteId, kind: 'note', quote: '', lessonId: '', blockId: '', created: Date.now(), order: Date.now()
  };
  const values = editorValues();
  const note = { ...existing, ...values, updated: Date.now() };
  await dbPut('notes', note);
  noteDirty = false;
  refreshNoteItem(note);
  setSaveStatus(`Salvato alle ${new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })}`);
  if (announce) showPatchToast('Appunto salvato.');
}

function scheduleEditorSave() {
  if (!activeNoteId) return;
  noteDirty = true;
  clearTimeout(noteSaveTimer);
  setSaveStatus('Modifiche in attesa di salvataggio…');
  noteSaveTimer = setTimeout(() => saveEditorNote(false).catch(error => {
    console.error(error);
    setSaveStatus('Salvataggio non riuscito: premi “Salva ora”', true);
  }), 600);
}

async function flushEditorSave() {
  clearTimeout(noteSaveTimer);
  if (noteDirty) await saveEditorNote(false);
}

function createNewNote() {
  activeNoteId = uid();
  noteDirty = false;
  $('#emptyEditor')?.classList.add('is-hidden');
  $('#noteEditor')?.classList.remove('is-hidden');
  if ($('#noteTitle')) $('#noteTitle').value = '';
  if ($('#noteFolder')) $('#noteFolder').value = 'Generali';
  if ($('#noteBody')) $('#noteBody').value = '';
  if ($('#noteSource')) $('#noteSource').textContent = 'Appunto libero';
  const list = $('#noteList');
  if (list) {
    if (list.querySelector('.muted')) list.innerHTML = '';
    const button = document.createElement('button');
    button.className = 'note-item active';
    button.dataset.noteId = activeNoteId;
    button.innerHTML = '<strong>Senza titolo</strong><small>Generali · oggi</small><span class="patch-note-snippet"></span>';
    list.prepend(button);
  }
  setSaveStatus('Nuovo appunto: salvataggio automatico attivo');
  $('#noteTitle')?.focus();
}

async function deleteActiveNote() {
  if (!activeNoteId || !confirm('Eliminare questo appunto?')) return;
  const note = await dbGet('notes', activeNoteId);
  if (note?.highlightId) await dbRemove('highlights', note.highlightId);
  await dbRemove('notes', activeNoteId);
  activeNoteId = null;
  noteDirty = false;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

async function moveActiveNote(delta) {
  if (!activeNoteId) return;
  await flushEditorSave();
  const note = await dbGet('notes', activeNoteId);
  if (!note) return;
  note.order = (note.order || Date.now()) + delta;
  note.updated = Date.now();
  await dbPut('notes', note);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportMarkdown() {
  await flushEditorSave();
  const notes = await dbAll('notes');
  const markdown = notes.map(note => `# ${note.title || 'Senza titolo'}\n\n**Cartella:** ${note.folder || 'Generali'}\n\n${note.quote ? `> ${note.quote}\n\n` : ''}${note.body || ''}`).join('\n\n---\n\n');
  downloadText('manuale-vivo-storia-II-appunti.md', markdown, 'text/markdown');
}

async function exportFullBackup() {
  await flushEditorSave();
  const data = {};
  for (const store of STORES) data[store] = await dbAll(store);
  downloadText('manuale-vivo-storia-II-backup.json', JSON.stringify({ app:'Manuale Vivo Storia II', version:2, exportedAt:new Date().toISOString(), data }, null, 2), 'application/json');
}

async function importBackup(file) {
  const payload = JSON.parse(await file.text());
  const data = Array.isArray(payload) ? { notes: payload } : payload.data;
  if (!data || !Array.isArray(data.notes)) throw new Error('Il file non contiene un backup valido.');
  if (!confirm('Ripristinare il backup? I dati locali delle sezioni presenti nel file verranno sostituiti.')) return;
  for (const [store, values] of Object.entries(data)) {
    if (!STORES.includes(store) || !Array.isArray(values)) continue;
    await dbClear(store);
    for (const value of values) await dbPut(store, value);
  }
  showPatchToast('Backup ripristinato.');
  setTimeout(() => location.reload(), 500);
}

function initNotesEnhancements() {
  if (!location.hash.startsWith('#/notes') || !$('#noteList')) return;
  const title = $('.section-head h1');
  if (title) title.textContent = 'Appunti ed evidenziazioni';
  const heading = $('.section-head > div');
  if (heading && !$('#patchNotesInfo')) {
    const info = document.createElement('p');
    info.id = 'patchNotesInfo';
    info.className = 'muted';
    info.textContent = 'Le evidenziazioni vengono raccolte qui automaticamente. L’editor salva le modifiche senza bisogno di uscire dalla pagina.';
    heading.append(info);
  }
  $('#exportJson') && ($('#exportJson').textContent = 'Backup completo');
  if (!$('#importBackup')) {
    const button = document.createElement('button');
    button.id = 'importBackup';
    button.type = 'button';
    button.textContent = 'Ripristina backup';
    const input = document.createElement('input');
    input.id = 'importBackupFile';
    input.type = 'file';
    input.accept = 'application/json';
    input.hidden = true;
    $('.section-head .button-row')?.insertBefore(button, $('#printNotes'));
    $('.section-head .button-row')?.append(input);
  }
  setSaveStatus('Salvataggio automatico attivo');
}

async function persistQuickDraft() {
  const field = $('#quickNote');
  const lessonId = currentLessonId();
  if (!field || !lessonId) return;
  await dbPut('settings', { id:`patchQuickDraft:${lessonId}`, value:field.value, updated:Date.now() });
  const status = $('#patchQuickStatus');
  if (status) status.textContent = 'Bozza salvata automaticamente';
}

async function initLessonEnhancements() {
  const lessonId = currentLessonId();
  if (!lessonId || !$('#studyDock')) return;
  if (!$('#patchStudyStatus')) {
    const status = document.createElement('p');
    status.id = 'patchStudyStatus';
    status.className = 'save-status patch-study-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Le evidenziazioni vengono salvate automaticamente e riportate negli Appunti.';
    $('.dock-actions')?.after(status);
  }
  const quick = $('#quickNote');
  if (quick && !$('#patchQuickStatus')) {
    const status = document.createElement('span');
    status.id = 'patchQuickStatus';
    status.className = 'save-status';
    $('#saveQuickNote')?.after(status);
    const draft = await dbGet('settings', `patchQuickDraft:${lessonId}`);
    if (!quick.value && draft?.value) {
      quick.value = draft.value;
      status.textContent = 'Bozza recuperata';
    }
  }
  addVisualButtons();
}

function ensureVisualDialog() {
  if ($('#patchVisualDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'patchVisualDialog';
  dialog.className = 'patch-visual-dialog';
  dialog.innerHTML = `<div class="patch-visual-card"><div class="patch-visual-toolbar"><strong id="patchVisualTitle">Schema ingrandito</strong><div><button type="button" data-patch-zoom="out" aria-label="Riduci">−</button><button type="button" data-patch-zoom="reset" id="patchZoomValue">100%</button><button type="button" data-patch-zoom="in" aria-label="Ingrandisci">＋</button><button type="button" data-patch-zoom="close" aria-label="Chiudi">×</button></div></div><div class="patch-visual-viewport"><div id="patchVisualContent" class="patch-visual-content"></div></div></div>`;
  document.body.append(dialog);
}

function applyZoom(value) {
  zoom = Math.max(.75, Math.min(2.5, value));
  const content = $('#patchVisualContent');
  if (!content) return;
  content.style.transform = `scale(${zoom})`;
  content.style.width = `${100 / zoom}%`;
  $('#patchZoomValue').textContent = `${Math.round(zoom * 100)}%`;
}

function openVisual(source, title) {
  ensureVisualDialog();
  const content = $('#patchVisualContent');
  content.replaceChildren(source.cloneNode(true));
  $('#patchVisualTitle').textContent = title;
  applyZoom(1);
  $('#patchVisualDialog').showModal();
  $('.patch-visual-viewport')?.scrollTo({ top:0, left:0 });
}

function addVisualButtons() {
  const schema = $('#schema .flow');
  const map = $('#mappa .concept-wrap');
  if (schema && !$('#patchExpandSchema')) {
    const button = document.createElement('button');
    button.id = 'patchExpandSchema';
    button.className = 'patch-expand-visual';
    button.type = 'button';
    button.textContent = '⤢ Ingrandisci lo schema';
    schema.before(button);
  }
  if (map && !$('#patchExpandMap')) {
    const button = document.createElement('button');
    button.id = 'patchExpandMap';
    button.className = 'patch-expand-visual';
    button.type = 'button';
    button.textContent = '⤢ Ingrandisci la mappa';
    map.before(button);
  }
}

async function initPageEnhancements() {
  await syncAllHighlights();
  initNotesEnhancements();
  await initLessonEnhancements();
}

const appObserver = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const marks = node.matches?.('mark[data-highlight-id]') ? [node] : $$('mark[data-highlight-id]', node);
      for (const mark of marks) syncHighlightById(mark.dataset.highlightId).catch(console.error);
    }
  }
  clearTimeout(appObserver._refresh);
  appObserver._refresh = setTimeout(() => initPageEnhancements().catch(console.error), 80);
});

appObserver.observe($('#app'), { childList:true, subtree:true });

document.addEventListener('click', async event => {
  const mark = event.target.closest?.('mark[data-highlight-id]');
  if (mark) activeHighlightId = mark.dataset.highlightId;

  const action = event.target.closest?.('[data-study-action]')?.dataset.studyAction;
  if (action === 'highlight') {
    setTimeout(() => syncAllHighlights().catch(console.error), 100);
    setTimeout(() => syncAllHighlights().catch(console.error), 500);
  }
  if (action === 'remove') {
    const id = activeHighlightId;
    setTimeout(() => removeLinkedHighlightNote(id).catch(console.error), 120);
  }

  const noteItem = event.target.closest?.('.note-item[data-note-id]');
  if (noteItem && location.hash.startsWith('#/notes')) {
    if (activeNoteId && activeNoteId !== noteItem.dataset.noteId) await flushEditorSave();
    activeNoteId = noteItem.dataset.noteId;
    noteDirty = false;
    setTimeout(() => setSaveStatus('Salvataggio automatico attivo'), 20);
  }

  if (event.target.closest?.('#newNote') && location.hash.startsWith('#/notes')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await flushEditorSave();
    createNewNote();
    return;
  }
  if (event.target.closest?.('#saveNote') && location.hash.startsWith('#/notes')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await saveEditorNote(true);
    return;
  }
  if (event.target.closest?.('#deleteNote') && location.hash.startsWith('#/notes')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    await deleteActiveNote();
    return;
  }
  if (event.target.closest?.('#moveUp') && location.hash.startsWith('#/notes')) {
    event.preventDefault(); event.stopImmediatePropagation(); await moveActiveNote(100000); return;
  }
  if (event.target.closest?.('#moveDown') && location.hash.startsWith('#/notes')) {
    event.preventDefault(); event.stopImmediatePropagation(); await moveActiveNote(-100000); return;
  }
  if (event.target.closest?.('#exportMarkdown') && location.hash.startsWith('#/notes')) {
    event.preventDefault(); event.stopImmediatePropagation(); await exportMarkdown(); return;
  }
  if (event.target.closest?.('#exportJson') && location.hash.startsWith('#/notes')) {
    event.preventDefault(); event.stopImmediatePropagation(); await exportFullBackup(); return;
  }
  if (event.target.closest?.('#importBackup')) { $('#importBackupFile')?.click(); return; }
  if (event.target.closest?.('#printNotes') && location.hash.startsWith('#/notes')) await flushEditorSave();

  if (event.target.closest?.('#saveQuickNote')) {
    setTimeout(async () => {
      const lessonId = currentLessonId();
      if (lessonId) await dbRemove('settings', `patchQuickDraft:${lessonId}`);
      const status = $('#patchQuickStatus');
      if (status) status.textContent = 'Appunto salvato';
    }, 80);
  }

  if (event.target.closest?.('#patchExpandSchema')) {
    const source = $('#schema .flow');
    if (source) openVisual(source, 'Schema del processo storico');
  }
  if (event.target.closest?.('#patchExpandMap') || event.target.closest?.('#mappa .concept-wrap')) {
    const source = $('#mappa .concept-map');
    if (source) openVisual(source, 'Mappa concettuale');
  }
  const zoomAction = event.target.closest?.('[data-patch-zoom]')?.dataset.patchZoom;
  if (zoomAction === 'in') applyZoom(zoom + .25);
  if (zoomAction === 'out') applyZoom(zoom - .25);
  if (zoomAction === 'reset') applyZoom(1);
  if (zoomAction === 'close') $('#patchVisualDialog')?.close();

  const routeLink = event.target.closest?.('a[href^="#/"]');
  if (routeLink && noteDirty) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const href = routeLink.getAttribute('href');
    await flushEditorSave();
    location.hash = href.slice(1);
  }
}, true);

document.addEventListener('input', event => {
  if (['noteTitle','noteFolder','noteBody'].includes(event.target.id) && location.hash.startsWith('#/notes')) {
    event.stopImmediatePropagation();
    scheduleEditorSave();
  }
  if (event.target.id === 'quickNote') {
    clearTimeout(quickDraftTimer);
    const status = $('#patchQuickStatus');
    if (status) status.textContent = 'Salvataggio bozza…';
    quickDraftTimer = setTimeout(() => persistQuickDraft().catch(console.error), 300);
  }
}, true);

document.addEventListener('change', event => {
  if (event.target.id === 'importBackupFile') {
    const file = event.target.files?.[0];
    if (file) importBackup(file).catch(error => showPatchToast(error.message || 'Backup non valido.'));
    event.target.value = '';
  }
}, true);

window.addEventListener('hashchange', () => {
  activeNoteId = null;
  noteDirty = false;
  clearTimeout(noteSaveTimer);
  setTimeout(() => initPageEnhancements().catch(console.error), 120);
});
window.addEventListener('pagehide', () => { flushEditorSave().catch(console.error); persistQuickDraft().catch(console.error); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushEditorSave().catch(console.error);
    persistQuickDraft().catch(console.error);
  }
});

ensureVisualDialog();
loadManualIndex().then(() => initPageEnhancements()).catch(console.error);
