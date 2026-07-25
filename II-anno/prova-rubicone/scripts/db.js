const DB = 'manuale-vivo-rubicone-db';
const VER = 1;
const STORES = [
  'progress',
  'readingPositions',
  'studySessions',
  'quizAttempts',
  'recoveryProgress',
  'highlights',
  'notes',
  'folders',
  'preferences',
  'contentVersions'
];

let dbp;

export function db() {
  if (dbp) return dbp;

  dbp = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VER);

    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossibile aprire il database locale.'));
    request.onblocked = () => reject(new Error('Il database locale è bloccato da una vecchia versione dell’app.'));
  });

  return dbp;
}

export async function put(store, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error || new Error(`Errore di scrittura in ${store}.`));
  });
}

export async function get(store, id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Errore di lettura da ${store}.`));
  });
}

export async function all(store) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Errore di lettura da ${store}.`));
  });
}

export async function del(store, id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`Errore di eliminazione da ${store}.`));
  });
}
