const DB_NAME='manuale-vivo-storia-ii-db';
const DB_VERSION=1;
const STORES=['progress','positions','sessions','attempts','highlights','notes','settings'];
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
let dbPromise;
let activeId=null;
let dirty=false;
let saveTimer=null;

function openDb(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{for(const store of STORES)if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Salvataggio locale non disponibile.'));
  });
  return dbPromise;
}
async function get(store,id){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction(store,'readonly').objectStore(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function put(store,value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);});}
async function remove(store,id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}

function onNotesPage(){return location.hash.startsWith('#/notes')&&Boolean($('#noteEditor'));}
function status(text,error=false){const el=$('#saveStatus');if(!el)return;el.textContent=text;el.classList.toggle('save-error',error);}
function values(){return{title:$('#noteTitle')?.value.trim()||'Senza titolo',folder:$('#noteFolder')?.value.trim()||'Generali',body:$('#noteBody')?.value||''};}
function updateItem(note){const item=$(`[data-note-id="${CSS.escape(note.id)}"]`);if(!item)return;item.querySelector('strong')?.replaceChildren(document.createTextNode(note.title));const small=item.querySelector('small');if(small)small.textContent=`${note.folder} · ${new Date(note.updated).toLocaleDateString('it-IT')}`;const snippet=item.querySelector('.notes-v2-snippet')||item.querySelector('span:last-child');if(snippet)snippet.textContent=note.body.slice(0,90);}

async function save(announce=false){
  clearTimeout(saveTimer);
  if(!activeId||!onNotesPage())return;
  const noteId=activeId;
  const editorValues=values();
  const existing=await get('notes',noteId)||{id:noteId,kind:'note',quote:'',lessonId:'',blockId:'',created:Date.now(),order:Date.now()};
  const note={...existing,...editorValues,id:noteId,updated:Date.now()};
  await put('notes',note);
  dirty=false;
  updateItem(note);
  status(`Salvato alle ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`);
  if(announce){const toast=$('#toast');if(toast){toast.textContent='Appunto salvato.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200);}}
}
function schedule(){if(!activeId)return;dirty=true;clearTimeout(saveTimer);status('Modifiche in attesa di salvataggio…');saveTimer=setTimeout(()=>save(false).catch(error=>{console.error(error);status('Salvataggio non riuscito: premi “Salva ora”',true);}),550);}
async function flush(){clearTimeout(saveTimer);if(dirty)await save(false);}

function fillSource(note){const source=$('#noteSource');if(!source)return;source.replaceChildren();if(note.lessonId){source.textContent=`Fonte collegata alla lezione${note.quote?` · Citazione: “${note.quote.slice(0,90)}${note.quote.length>90?'…':''}”`:''}`;}else source.textContent='Appunto libero';}
async function select(id){
  if(activeId&&activeId!==id&&dirty)await flush();
  const note=await get('notes',id);if(!note)return;
  activeId=id;dirty=false;
  $('#emptyEditor')?.classList.add('is-hidden');$('#noteEditor')?.classList.remove('is-hidden');
  $('#noteTitle').value=note.title||'';$('#noteFolder').value=note.folder||'Generali';$('#noteBody').value=note.body||'';fillSource(note);
  $$('.note-item').forEach(item=>item.classList.toggle('active',item.dataset.noteId===id));
  status(note.kind==='highlight'?'Evidenziazione salvata automaticamente':'Salvataggio automatico attivo');
}
function create(){
  activeId=uid();dirty=false;
  $('#emptyEditor')?.classList.add('is-hidden');$('#noteEditor')?.classList.remove('is-hidden');
  $('#noteTitle').value='';$('#noteFolder').value='Generali';$('#noteBody').value='';$('#noteSource').textContent='Appunto libero';
  const list=$('#noteList');if(list){if(list.querySelector('.muted'))list.innerHTML='';const button=document.createElement('button');button.className='note-item active';button.dataset.noteId=activeId;button.innerHTML='<strong>Senza titolo</strong><small>Generali · oggi</small><span class="notes-v2-snippet"></span>';list.prepend(button);}
  status('Nuovo appunto: salvataggio automatico attivo');$('#noteTitle')?.focus();
}
async function erase(){if(!activeId||!confirm('Eliminare questo appunto?'))return;const note=await get('notes',activeId);if(note?.highlightId)await remove('highlights',note.highlightId);await remove('notes',activeId);activeId=null;dirty=false;window.dispatchEvent(new HashChangeEvent('hashchange'));}
async function move(delta){if(!activeId)return;await flush();const note=await get('notes',activeId);if(!note)return;note.order=(note.order||Date.now())+delta;note.updated=Date.now();await put('notes',note);window.dispatchEvent(new HashChangeEvent('hashchange'));}
function reset(){activeId=null;dirty=false;clearTimeout(saveTimer);setTimeout(()=>{if(onNotesPage())status('Salvataggio automatico attivo');},180);}

window.addEventListener('click',async event=>{
  if(!onNotesPage())return;
  const item=event.target.closest?.('.note-item[data-note-id]');
  if(item){event.preventDefault();event.stopImmediatePropagation();await select(item.dataset.noteId);return;}
  if(event.target.closest?.('#newNote')){event.preventDefault();event.stopImmediatePropagation();await flush();create();return;}
  if(event.target.closest?.('#saveNote')){event.preventDefault();event.stopImmediatePropagation();await save(true);return;}
  if(event.target.closest?.('#deleteNote')){event.preventDefault();event.stopImmediatePropagation();await erase();return;}
  if(event.target.closest?.('#moveUp')){event.preventDefault();event.stopImmediatePropagation();await move(100000);return;}
  if(event.target.closest?.('#moveDown')){event.preventDefault();event.stopImmediatePropagation();await move(-100000);return;}
  const link=event.target.closest?.('a[href^="#/"]');
  if(link&&dirty){event.preventDefault();event.stopImmediatePropagation();const href=link.getAttribute('href');await flush();location.hash=href.slice(1);}
},true);
window.addEventListener('input',event=>{if(onNotesPage()&&['noteTitle','noteFolder','noteBody'].includes(event.target.id)){event.stopImmediatePropagation();schedule();}},true);
window.addEventListener('hashchange',reset);
window.addEventListener('pagehide',()=>flush().catch(console.error));
document.addEventListener('visibilitychange',()=>{if(document.hidden)flush().catch(console.error);});
reset();
