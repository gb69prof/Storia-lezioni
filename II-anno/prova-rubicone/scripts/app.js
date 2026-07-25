import { put, get, all, del } from './db.js';

const main = document.querySelector('#main');
const toastEl = document.querySelector('#toast');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let lesson;
let quiz;
let timer = null;
let lastActive = Date.now();
let elapsedChunk = 0;
let selectionHandlerBound = false;

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Impossibile caricare ${path} (${response.status}).`);
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) {
    throw new Error(`${path} non contiene dati JSON validi.`);
  }
  return response.json();
}

async function load() {
  [lesson, quiz] = await Promise.all([
    fetchJson('./content/il-rubicone.json'),
    fetchJson('./quiz/il-rubicone.json')
  ]);
  await route();
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function progress() {
  return await get('progress', 'il-rubicone') || {
    id: 'il-rubicone',
    state: 'Non iniziata',
    percent: 0,
    seconds: 0
  };
}

async function saveProgress(data) {
  await put('progress', {
    id: 'il-rubicone',
    ...data,
    updated: Date.now()
  });
}

function setRoute(routeValue) {
  location.hash = routeValue;
}

function currentSectionFromHash() {
  const match = (location.hash || '').match(/^#\/lesson\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

window.addEventListener('hashchange', () => route().catch(showFatalError));
window.addEventListener('visibilitychange', () => {
  lastActive = Date.now();
});
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(eventName => {
  window.addEventListener(eventName, () => {
    lastActive = Date.now();
  }, { passive: true });
});

async function route() {
  stopTimer();
  const hash = location.hash || '#/';

  if (hash.startsWith('#/lesson')) {
    await renderLesson(currentSectionFromHash());
  } else if (hash.startsWith('#/quiz')) {
    await renderQuiz();
  } else if (hash.startsWith('#/notes')) {
    await renderNotes();
  } else if (hash.startsWith('#/search')) {
    await renderSearch();
  } else if (hash.startsWith('#/report')) {
    await renderReport();
  } else {
    await renderHome();
  }

  main.focus({ preventScroll: true });
}

async function renderHome() {
  const p = await progress();
  const notes = (await all('notes')).length;

  main.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Storia II · Prototipo didattico</div>
        <h1>Manuale Vivo</h1>
        <p>Dalla crisi della Repubblica alla nascita dell’Europa medievale. Un manuale che collega lettura, organizzazione, verifica e recupero.</p>
        <p><a class="button primary" href="#/lesson">${p.state === 'Non iniziata' ? 'Inizia Il Rubicone' : 'Continua Il Rubicone'}</a></p>
      </div>
      <aside class="hero-card">
        <div class="eyebrow">Il tuo studio</div>
        <h2>${esc(p.state)}</h2>
        <div class="progress"><span style="width:${Number(p.percent) || 0}%"></span></div>
        <div class="metrics">
          <div class="metric"><strong>${Number(p.percent) || 0}%</strong><span>completato</span></div>
          <div class="metric"><strong>${Math.round((Number(p.seconds) || 0) / 60)}</strong><span>minuti</span></div>
          <div class="metric"><strong>${notes}</strong><span>appunti</span></div>
        </div>
      </aside>
    </section>
    <section class="section">
      <div class="eyebrow">Percorsi</div>
      <h2>La storia come processo</h2>
      <div class="module-grid">
        <article class="card module-card">
          <span class="status">Disponibile</span>
          <h3>La Repubblica diventa Impero</h3>
          <p>II–I secolo a.C.</p>
          <p>Lezione attiva: <a href="#/lesson">Il Rubicone</a></p>
        </article>
        ${['Il potere e il sangue', 'Dai Flavi a Diocleziano', 'Dall’Impero tardoantico a Carlo Magno'].map(title => `
          <article class="card module-card">
            <span class="status">In preparazione</span>
            <h3>${esc(title)}</h3>
            <p>Il percorso sarà aggiunto senza modificare l’architettura dell’app.</p>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function toc() {
  return lesson.blocks.map(block => `
    <a href="#/lesson/${encodeURIComponent(block.id)}">${esc(block.title)}</a>
  `).join('');
}

async function renderLesson(sectionId = null) {
  const p = await progress();
  if (p.state === 'Non iniziata') {
    await saveProgress({ ...p, state: 'In lettura', percent: 5 });
  }

  const savedPosition = await get('readingPositions', 'il-rubicone');
  const targetSection = sectionId || savedPosition?.block || null;

  main.innerHTML = `
    <div class="lesson-layout">
      <aside class="side desktop-side">
        <div class="eyebrow">Indice</div>
        <nav class="toc">
          ${toc()}
          <a href="#/lesson/strumenti">Strumenti di studio</a>
          <a href="#/lesson/sintesi">Sintesi</a>
        </nav>
      </aside>
      <article class="reader">
        <div class="eyebrow">La Repubblica diventa Impero · ${esc(lesson.period)}</div>
        <h1 class="lesson-title">${esc(lesson.title)}</h1>
        <p class="lead">${esc(lesson.subtitle)}</p>
        <p>${esc(lesson.intro)}</p>
        <div class="problem"><strong>Il problema</strong><p>${esc(lesson.problem)}</p></div>
        ${lesson.blocks.map(block => `
          <section class="content-block" id="${esc(block.id)}" data-block="${esc(block.id)}">
            <h2>${esc(block.title)}</h2>
            <p>${esc(block.text)}</p>
          </section>
        `).join('')}
        <section id="strumenti">
          <h2>Organizza ciò che hai compreso</h2>
          <h3>Timeline</h3>
          <div class="timeline">
            ${lesson.timeline.map(item => `<div class="time-item"><strong>${esc(item[0])}</strong><br>${esc(item[1])}</div>`).join('')}
          </div>
          <h3>Schema causale</h3>
          <div class="flow">
            ${lesson.schema.map(item => `<div class="flow-step">${esc(item)}</div>`).join('')}
          </div>
          <h3>Mappa concettuale</h3>
          <a href="./assets/maps/cesare-mappa.webp" target="_blank" rel="noopener">
            <img class="map-img" src="./assets/maps/cesare-mappa-thumb.webp" alt="Mappa concettuale su Giulio Cesare: ascesa politica, conquista della Gallia, guerra civile, dittatura e morte">
          </a>
          <details>
            <summary>Trascrizione accessibile della mappa</summary>
            <p>La mappa colloca Giulio Cesare al centro e collega formazione politica, primo triumvirato, campagne galliche, passaggio del Rubicone, guerra contro Pompeo, dittatura, riforme e Idi di marzo.</p>
          </details>
          <h3>Saperi irrinunciabili</h3>
          <div class="essential-grid">
            ${lesson.essentials.map((item, index) => `<div class="essential"><strong>${index + 1}</strong><br>${esc(item)}</div>`).join('')}
          </div>
          <h3>Vocabolario essenziale</h3>
          <table class="glossary"><tbody>
            ${lesson.glossary.map(item => `<tr><td><strong>${esc(item[0])}</strong></td><td>${esc(item[1])}</td></tr>`).join('')}
          </tbody></table>
        </section>
        <section id="sintesi">
          <h2>Sintesi</h2>
          <p class="summary">${esc(lesson.summary)}</p>
          <label for="answerProblem"><strong>Ora rispondi al problema con parole tue</strong></label>
          <textarea id="answerProblem" placeholder="Spiega perché quel piccolo fiume divenne un punto di non ritorno."></textarea>
          <p>
            <button id="saveReflection">Salva negli appunti</button>
            <a class="button primary" href="#/quiz">Avvia il test finale</a>
          </p>
        </section>
      </article>
      <aside class="side desktop-side">
        <div class="problem"><strong>Domanda guida</strong><p>${esc(lesson.problem)}</p></div>
        <div class="card"><strong>Tempo previsto</strong><p>${Number(lesson.duration) || 18} minuti</p><a href="#/notes">Apri appunti</a></div>
      </aside>
    </div>
    <div id="selbar" class="selection-toolbar">
      <button data-action="highlight">Evidenzia</button>
      <button data-action="note">Appunti</button>
    </div>
  `;

  await applyHighlights();
  bindSelection();

  $('#saveReflection')?.addEventListener('click', async () => {
    const body = $('#answerProblem').value.trim();
    if (!body) return toast('Scrivi prima una risposta');
    await put('notes', {
      id: crypto.randomUUID(),
      title: 'Risposta al problema',
      body,
      source: 'il-rubicone',
      created: Date.now()
    });
    toast('Risposta salvata');
  });

  startTimer();

  if (targetSection) {
    requestAnimationFrame(() => {
      const target = document.getElementById(targetSection);
      target?.scrollIntoView({ behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth', block: 'start' });
    });
  }

  window.addEventListener('scroll', saveReading, { passive: true });
}

function startTimer() {
  timer = window.setInterval(async () => {
    if (Date.now() - lastActive < 60000 && !document.hidden) {
      elapsedChunk += 1;
      if (elapsedChunk >= 15) {
        elapsedChunk = 0;
        const p = await progress();
        const denominator = Math.max(1, document.body.scrollHeight - window.innerHeight);
        const readingPercent = Math.min(65, Math.max(5, Math.round((window.scrollY / denominator) * 65)));
        await saveProgress({
          ...p,
          seconds: (Number(p.seconds) || 0) + 15,
          percent: Math.max(Number(p.percent) || 0, readingPercent)
        });
      }
    }
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  elapsedChunk = 0;
  window.removeEventListener('scroll', saveReading);
}

function saveReading() {
  const candidates = lesson?.blocks || [];
  const current = [...candidates].reverse().find(block => {
    const element = document.getElementById(block.id);
    return element && element.getBoundingClientRect().top <= 180;
  }) || candidates[0];

  if (current) {
    put('readingPositions', {
      id: 'il-rubicone',
      block: current.id,
      updated: Date.now()
    }).catch(console.error);
  }
}

function bindSelection() {
  const bar = $('#selbar');
  if (!bar) return;

  const updateBar = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !$('.reader')?.contains(selection.anchorNode)) {
      bar.style.display = 'none';
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    bar.style.display = 'block';
    bar.style.left = `${window.scrollX + rect.left}px`;
    bar.style.top = `${window.scrollY + rect.top - 48}px`;
  };

  if (!selectionHandlerBound) {
    document.addEventListener('selectionchange', updateBar);
    selectionHandlerBound = true;
  }

  bar.addEventListener('click', async event => {
    const action = event.target.dataset.action;
    if (!action) return;

    const selection = getSelection();
    const text = selection?.toString().trim();
    const block = selection?.anchorNode?.parentElement?.closest('[data-block]');
    if (!text || !block) return;

    await put('highlights', {
      id: crypto.randomUUID(),
      lesson: 'il-rubicone',
      block: block.dataset.block,
      text,
      color: 'yellow',
      created: Date.now()
    });

    if (action === 'note') {
      await put('notes', {
        id: crypto.randomUUID(),
        title: text.slice(0, 42),
        body: text,
        source: block.dataset.block,
        created: Date.now()
      });
    }

    selection.removeAllRanges();
    bar.style.display = 'none';
    await applyHighlights();
    toast(action === 'note' ? 'Copiato negli appunti' : 'Evidenziato');
  }, { once: true });
}

async function applyHighlights() {
  for (const highlight of await all('highlights')) {
    if (highlight.lesson !== 'il-rubicone') continue;
    const paragraph = document.querySelector(`[data-block="${CSS.escape(highlight.block)}"] p`);
    if (!paragraph || paragraph.querySelector('mark')) continue;
    const index = paragraph.textContent.indexOf(highlight.text);
    if (index < 0) continue;
    const text = paragraph.textContent;
    paragraph.innerHTML = `${esc(text.slice(0, index))}<mark class="hl-${esc(highlight.color)}" title="Evidenziazione salvata">${esc(highlight.text)}</mark>${esc(text.slice(index + highlight.text.length))}`;
  }
}

let answers = [];

async function renderQuiz() {
  answers = Array(quiz.questions.length).fill(null);
  let index = 0;

  const draw = () => {
    const question = quiz.questions[index];
    main.innerHTML = `
      <div class="quiz-wrap">
        <div class="eyebrow">Verifica · domanda ${index + 1} di ${quiz.questions.length}</div>
        <div class="progress"><span style="width:${((index + 1) / quiz.questions.length) * 100}%"></span></div>
        <h1>${esc(question.text)}</h1>
        <div>
          ${question.options.map((option, optionIndex) => `<button class="option ${answers[index] === optionIndex ? 'selected' : ''}" data-option="${optionIndex}">${esc(option)}</button>`).join('')}
        </div>
        <p>
          <button id="prev" ${index === 0 ? 'disabled' : ''}>Indietro</button>
          <button id="next" class="primary">${index === quiz.questions.length - 1 ? 'Consegna' : 'Avanti'}</button>
        </p>
      </div>
    `;

    $$('.option').forEach(button => button.addEventListener('click', () => {
      answers[index] = Number(button.dataset.option);
      draw();
    }));

    $('#prev').addEventListener('click', () => {
      index -= 1;
      draw();
    });

    $('#next').addEventListener('click', async () => {
      if (answers[index] === null) return toast('Scegli una risposta');
      if (index < quiz.questions.length - 1) {
        index += 1;
        draw();
        return;
      }

      const attempt = {
        id: 'latest',
        answers,
        score: answers.filter((answer, answerIndex) => answer === quiz.questions[answerIndex].correct).length,
        total: quiz.questions.length,
        seconds: 0,
        created: Date.now(),
        recovered: []
      };
      await put('quizAttempts', attempt);
      const p = await progress();
      await saveProgress({
        ...p,
        state: attempt.score / attempt.total >= 0.7 ? 'Verificata' : 'Da recuperare',
        percent: 75
      });
      setRoute('#/report');
    });
  };

  draw();
}

async function renderReport() {
  const attempt = await get('quizAttempts', 'latest');
  if (!attempt) return setRoute('#/quiz');

  const percentage = Math.round((attempt.score / attempt.total) * 100);
  const wrong = quiz.questions
    .map((question, index) => ({ question, index, chosen: attempt.answers[index] }))
    .filter(item => item.chosen !== item.question.correct);
  const level = percentage < 50 ? 'Da riprendere' : percentage < 70 ? 'Comprensione parziale' : percentage < 85 ? 'Comprensione adeguata' : 'Concetto consolidato';

  main.innerHTML = `
    <div class="quiz-wrap">
      <div class="eyebrow">Report finale</div>
      <h1>${level}</h1>
      <div class="report-grid">
        <div class="card"><strong>${attempt.score}</strong><br>corrette</div>
        <div class="card"><strong>${attempt.total - attempt.score}</strong><br>errori</div>
        <div class="card"><strong>${percentage}%</strong><br>risultato</div>
        <div class="card"><strong>${attempt.recovered.length}</strong><br>recuperati</div>
      </div>
      ${wrong.length ? `
        <h2>Recupera gli errori</h2>
        ${wrong.map(item => `
          <section class="recovery" data-recovery="${item.index}">
            <h3>${esc(item.question.text)}</h3>
            <p><strong>Hai scelto:</strong> ${esc(item.question.options[item.chosen])}</p>
            <p>${esc(item.question.mis[item.chosen])}</p>
            <p><a href="#/lesson/${encodeURIComponent(item.question.block)}">Rivedi il punto della lezione</a></p>
            <label>${esc(item.question.check)}
              <select>
                <option value="">Scegli</option>
                ${item.question.checkOptions.map((option, optionIndex) => `<option value="${optionIndex}">${esc(option)}</option>`).join('')}
              </select>
            </label>
            <button class="checkRecovery">Controlla</button>
            <span role="status"></span>
          </section>
        `).join('')}
      ` : '<p class="summary">Hai risposto correttamente a tutte le domande.</p>'}
      <p><a class="button" href="#/quiz">Ripeti il test</a> <a class="button primary" href="#/">Torna alla Home</a></p>
    </div>
  `;

  $$('.checkRecovery').forEach(button => button.addEventListener('click', async () => {
    const section = button.closest('.recovery');
    const questionIndex = Number(section.dataset.recovery);
    const rawValue = section.querySelector('select').value;
    const status = section.querySelector('[role="status"]');
    if (rawValue === '') return status.textContent = ' Scegli una risposta.';

    if (Number(rawValue) === quiz.questions[questionIndex].checkCorrect) {
      status.textContent = ' Corretto: concetto recuperato.';
      section.style.borderColor = 'var(--good)';
      if (!attempt.recovered.includes(questionIndex)) attempt.recovered.push(questionIndex);
      await put('quizAttempts', attempt);
      const remaining = wrong.filter(item => !attempt.recovered.includes(item.index)).length;
      if (!remaining) {
        const p = await progress();
        await saveProgress({ ...p, state: 'Consolidata', percent: 100 });
      }
    } else {
      status.textContent = ' Non ancora: rileggi la spiegazione.';
    }
  }));
}

async function renderNotes() {
  let notes = await all('notes');
  notes.sort((a, b) => b.created - a.created);

  main.innerHTML = `
    <section class="section">
      <div class="eyebrow">Studio personale</div>
      <h1>Appunti</h1>
      <div class="notes-layout">
        <aside class="card">
          <button id="newNote" class="primary">Nuovo appunto</button>
          <div id="noteList">
            ${notes.map(note => `<button class="note-item" data-id="${esc(note.id)}"><strong>${esc(note.title)}</strong><br><small>${new Date(note.created).toLocaleDateString('it-IT')}</small></button>`).join('')}
          </div>
        </aside>
        <div class="card">
          <label>Titolo<input id="noteTitle" type="text"></label>
          <label>Testo<textarea id="noteBody"></textarea></label>
          <p><button id="saveNote" class="primary">Salva</button> <button id="deleteNote">Elimina</button> <button id="exportNotes">Esporta JSON</button></p>
        </div>
      </div>
    </section>
  `;

  let current = null;
  const select = note => {
    current = note;
    $('#noteTitle').value = note?.title || '';
    $('#noteBody').value = note?.body || '';
  };

  $$('.note-item').forEach(element => element.addEventListener('click', () => select(notes.find(note => note.id === element.dataset.id))));
  $('#newNote').addEventListener('click', () => select({ id: crypto.randomUUID(), title: '', body: '', created: Date.now() }));
  $('#saveNote').addEventListener('click', async () => {
    if (!current) current = { id: crypto.randomUUID(), created: Date.now() };
    current.title = $('#noteTitle').value || 'Senza titolo';
    current.body = $('#noteBody').value;
    await put('notes', current);
    toast('Appunto salvato');
    await renderNotes();
  });
  $('#deleteNote').addEventListener('click', async () => {
    if (current) {
      await del('notes', current.id);
      await renderNotes();
    }
  });
  $('#exportNotes').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'manuale-vivo-appunti.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  });
}

async function renderSearch() {
  main.innerHTML = `
    <section class="section">
      <div class="eyebrow">Ricerca globale</div>
      <h1>Cerca nel Manuale Vivo</h1>
      <label for="q">Termine o concetto</label>
      <input id="q" type="search" placeholder="Es. clemenza, Farsalo, imperium">
      <div id="results" aria-live="polite"></div>
    </section>
  `;

  const notes = await all('notes');
  $('#q').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    const results = $('#results');
    if (query.length < 2) {
      results.innerHTML = '';
      return;
    }

    const hits = [];
    lesson.blocks.forEach(block => {
      if (`${block.title} ${block.text}`.toLowerCase().includes(query)) {
        hits.push({ title: block.title, text: block.text, href: `#/lesson/${encodeURIComponent(block.id)}` });
      }
    });
    lesson.glossary.forEach(item => {
      if (item.join(' ').toLowerCase().includes(query)) {
        hits.push({ title: item[0], text: item[1], href: '#/lesson/strumenti' });
      }
    });
    notes.forEach(note => {
      if (`${note.title} ${note.body}`.toLowerCase().includes(query)) {
        hits.push({ title: note.title, text: note.body, href: '#/notes' });
      }
    });

    results.innerHTML = hits.length
      ? hits.map(hit => `<article class="search-result"><h3><a href="${hit.href}">${esc(hit.title)}</a></h3><p>${esc(hit.text.slice(0, 220))}</p></article>`).join('')
      : '<p>Nessun risultato.</p>';
  });
}

function showFatalError(error) {
  console.error(error);
  main.innerHTML = `
    <section class="section error-panel" role="alert">
      <div class="eyebrow">Errore di avvio</div>
      <h1>Il Manuale Vivo non è riuscito a caricarsi</h1>
      <p>${esc(error?.message || 'Errore sconosciuto.')}</p>
      <p>Prova a ricaricare la pagina. Se il problema continua, elimina i dati del sito da Safari e riaprilo.</p>
      <button id="reloadApp" class="primary">Ricarica</button>
    </section>
  `;
  $('#reloadApp')?.addEventListener('click', () => location.reload());
}

$('#themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  put('preferences', {
    id: 'theme',
    value: document.body.classList.contains('dark') ? 'dark' : 'light'
  }).catch(console.error);
});

$('#settingsBtn').addEventListener('click', () => $('#settingsDialog').showModal());
$('#fontSize').addEventListener('input', event => {
  document.documentElement.style.setProperty('--font', `${event.target.value}px`);
  put('preferences', { id: 'font', value: event.target.value }).catch(console.error);
});
$('#reduceMotion').addEventListener('change', event => {
  document.body.classList.toggle('reduce-motion', event.target.checked);
  put('preferences', { id: 'reduceMotion', value: event.target.checked }).catch(console.error);
});

(async () => {
  try {
    main.innerHTML = '<section class="section"><p>Caricamento del Manuale Vivo…</p></section>';
    const [theme, font, reduceMotion] = await Promise.all([
      get('preferences', 'theme'),
      get('preferences', 'font'),
      get('preferences', 'reduceMotion')
    ]);

    if (theme?.value === 'dark') document.body.classList.add('dark');
    if (font?.value) {
      document.documentElement.style.setProperty('--font', `${font.value}px`);
      $('#fontSize').value = font.value;
    }
    if (reduceMotion?.value) {
      document.body.classList.add('reduce-motion');
      $('#reduceMotion').checked = true;
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service Worker non registrato:', error));
    }

    await load();
  } catch (error) {
    showFatalError(error);
  }
})();
